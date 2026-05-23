#!/usr/bin/env python3
"""
Migration complète VoucherNet : VPS source -> VPS cible
  - dump PostgreSQL (base vouchernet)
  - copie .env production
  - clone / build app sur le nouveau VPS si nécessaire

Prérequis :
  - deploy/vps.local.env        (VPS actuel, source)
  - deploy/vps.target.local.env (nouveau VPS, cible)

Usage :
  python deploy/migrate-full-vps.py
  python deploy/migrate-full-vps.py --skip-bootstrap   # si le VPS cible est déjà préparé
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

DEPLOY_DIR = Path(__file__).resolve().parent
REPO_ROOT = DEPLOY_DIR.parent
SOURCE_ENV = DEPLOY_DIR / "vps.local.env"
TARGET_ENV = DEPLOY_DIR / "vps.target.local.env"
DUMP_REMOTE = "/tmp/vouchernet_migrate.dump"


def load_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        print(f"Fichier manquant : {path}", file=sys.stderr)
        sys.exit(1)
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def ensure_paramiko():
    try:
        import paramiko  # noqa: F401
    except ImportError:
        print("==> Installation paramiko...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])


def ssh_connect(host: str, user: str, password: str, port: int):
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=60)
    return client


def run(client, cmd: str, timeout: int = 900) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def shell_quote(s: str) -> str:
    return "'" + s.replace("'", "'\"'\"'") + "'"


def parse_database_url(url: str) -> dict[str, str]:
    u = urlparse(url.strip())
    return {
        "user": unquote(u.username or ""),
        "password": unquote(u.password or ""),
        "host": u.hostname or "127.0.0.1",
        "port": str(u.port or 5432),
        "database": (u.path or "/vouchernet").lstrip("/") or "vouchernet",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Migration VPS VoucherNet (app + PostgreSQL)")
    parser.add_argument("--skip-bootstrap", action="store_true", help="Ne pas installer Node/nginx/postgres sur la cible")
    parser.add_argument(
        "--from-local-dump",
        action="store_true",
        help="Utiliser backups/vouchernet-vps-latest.dump au lieu de dumper le VPS source",
    )
    args = parser.parse_args()

    src = load_env(SOURCE_ENV)
    tgt = load_env(TARGET_ENV)

    src_host = src.get("VPS_HOST", "")
    src_user = src.get("VPS_USER", "root")
    src_pass = src.get("VPS_SSH_PASSWORD", "")
    src_port = int(src.get("VPS_PORT", "22"))
    src_app = src.get("VPS_APP_DIR", "/var/www/vouchernet")

    tgt_host = tgt.get("TARGET_VPS_HOST") or tgt.get("VPS_HOST", "")
    tgt_user = tgt.get("TARGET_VPS_USER") or tgt.get("VPS_USER", "root")
    tgt_pass = tgt.get("TARGET_VPS_SSH_PASSWORD") or tgt.get("VPS_SSH_PASSWORD", "")
    tgt_port = int(tgt.get("TARGET_VPS_PORT") or tgt.get("VPS_PORT", "22"))
    tgt_app = tgt.get("TARGET_VPS_APP_DIR") or tgt.get("VPS_APP_DIR", "/var/www/vouchernet")
    branch = tgt.get("VOUCHERNET_BRANCH", src.get("VOUCHERNET_BRANCH", "main"))
    repo = tgt.get("GITHUB_REPO", "https://github.com/blackanonymous24-hue/nanoTECH_VoucherProd1.git")
    domain = tgt.get("TARGET_DOMAIN", "").strip()

    local_dump_default = REPO_ROOT / "backups" / "vouchernet-vps-latest.dump"
    local_env_default = REPO_ROOT / "backups" / "vouchernet-vps-production.env"

    if not args.from_local_dump and (not src_pass or src_pass == "CHANGE_ME"):
        print("Renseignez VPS_SSH_PASSWORD dans deploy/vps.local.env", file=sys.stderr)
        sys.exit(1)
    if not tgt_host:
        print("Renseignez TARGET_VPS_HOST dans deploy/vps.target.local.env", file=sys.stderr)
        sys.exit(1)
    if not tgt_pass or tgt_pass == "CHANGE_ME":
        print("Renseignez TARGET_VPS_SSH_PASSWORD dans deploy/vps.target.local.env", file=sys.stderr)
        sys.exit(1)
    if src_host == tgt_host:
        print("Source et cible ont la même IP — abandon.", file=sys.stderr)
        sys.exit(1)

    ensure_paramiko()
    import paramiko

    if args.from_local_dump:
        print("==> Source : dump local (backups/)")
        local_dump = local_dump_default
        if not local_dump.is_file():
            print(f"Fichier manquant : {local_dump}. Lancez : pnpm run db:sync-vps-local", file=sys.stderr)
            sys.exit(1)
        if not local_env_default.is_file():
            print(f"Fichier manquant : {local_env_default}. Relancez db:sync-vps-local.", file=sys.stderr)
            sys.exit(1)
        env_body = local_env_default.read_text(encoding="utf-8")
        db_url = ""
        for line in env_body.splitlines():
            if line.startswith("DATABASE_URL="):
                db_url = line.split("=", 1)[1].strip()
                break
        if not db_url:
            print("DATABASE_URL absent du backup .env", file=sys.stderr)
            sys.exit(1)
        db = parse_database_url(db_url)
        dump_size = local_dump.stat().st_size
        print(f"    Dump local : {dump_size / 1024 / 1024:.2f} MiB")
    else:
        print(f"==> Source : {src_user}@{src_host}")
        src_client = ssh_connect(src_host, src_user, src_pass, src_port)
        try:
            print("==> Lecture .env source...")
            code, env_body, err = run(src_client, f"cat {shell_quote(src_app + '/.env')} 2>/dev/null || true")
            if not env_body.strip():
                print("Fichier .env introuvable sur la source.", file=sys.stderr)
                sys.exit(1)

            db_url = ""
            for line in env_body.splitlines():
                if line.startswith("DATABASE_URL="):
                    db_url = line.split("=", 1)[1].strip()
                    break
            if not db_url:
                print("DATABASE_URL absent du .env source.", file=sys.stderr)
                sys.exit(1)

            db = parse_database_url(db_url)
            print(f"==> Dump PostgreSQL ({db['database']})...")
            dump_cmd = (
                f"sudo -u postgres pg_dump -Fc {shell_quote(db['database'])} -f {shell_quote(DUMP_REMOTE)} "
                f"&& ls -lh {shell_quote(DUMP_REMOTE)}"
            )
            code, out, err = run(src_client, dump_cmd, timeout=1800)
            print(out, end="")
            if code != 0:
                print(err, file=sys.stderr)
                sys.exit(code)

            with tempfile.NamedTemporaryFile(delete=False, suffix=".dump") as tmp:
                local_dump = Path(tmp.name)
            print(f"==> Téléchargement dump -> {local_dump}")
            sftp = src_client.open_sftp()
            try:
                sftp.get(DUMP_REMOTE, str(local_dump))
            finally:
                sftp.close()
            run(src_client, f"rm -f {shell_quote(DUMP_REMOTE)}")
        finally:
            src_client.close()
        dump_size = local_dump.stat().st_size
        print(f"    Taille dump : {dump_size / 1024 / 1024:.2f} MiB")

    print(f"==> Cible  : {tgt_user}@{tgt_host}")

    # ── 2. Préparation cible ─────────────────────────────────────────────
    tgt_client = ssh_connect(tgt_host, tgt_user, tgt_pass, tgt_port)
    try:
        code, out, _ = run(tgt_client, f"test -d {shell_quote(tgt_app)} && echo EXISTS || echo MISSING")
        app_exists = "EXISTS" in out

        if not args.skip_bootstrap:
            print("==> Bootstrap système (apt, node, nginx, postgres)...")
            prep = (
                "export DEBIAN_FRONTEND=noninteractive; "
                "apt-get update -qq && apt-get install -y git curl postgresql postgresql-contrib; "
                "systemctl enable postgresql && systemctl start postgresql"
            )
            code, _, err = run(tgt_client, prep, timeout=600)
            if code != 0:
                print(err, file=sys.stderr)
                sys.exit(code)

        if not app_exists:
            print(f"==> Clone dépôt dans {tgt_app}...")
            clone_cmd = (
                f"mkdir -p {shell_quote(tgt_app)} && "
                f"git clone --branch {shell_quote(branch)} --depth 1 {shell_quote(repo)} {shell_quote(tgt_app)}"
            )
            code, out, err = run(tgt_client, clone_cmd, timeout=300)
            print(out, end="")
            if code != 0:
                print(err, file=sys.stderr)
                sys.exit(code)

        if not args.skip_bootstrap:
            print("==> hostinger-vps-setup.sh...")
            code, out, err = run(
                tgt_client,
                f"cd {shell_quote(tgt_app)} && bash deploy/hostinger-vps-setup.sh",
                timeout=600,
            )
            print(out, end="")
            if code != 0:
                print(err, file=sys.stderr)
                sys.exit(code)

            pg_pass = db["password"]
            print("==> PostgreSQL (même identifiants que la source)...")
            pg_setup = (
                f"cd {shell_quote(tgt_app)} && "
                f"export POSTGRES_VOUCHERNET_PASSWORD={shell_quote(pg_pass)} && "
                f"bash deploy/postgres-vps-setup.sh"
            )
            code, out, err = run(tgt_client, pg_setup, timeout=300)
            print(out, end="")
            if code != 0:
                print(err, file=sys.stderr)
                sys.exit(code)

        # ── 3. Upload dump + restore ───────────────────────────────────────
        remote_dump = "/tmp/vouchernet_restore.dump"
        print("==> Upload dump vers la cible...")
        sftp = tgt_client.open_sftp()
        try:
            sftp.put(str(local_dump), remote_dump)
        finally:
            sftp.close()

        print("==> Restauration base (pg_restore --clean)...")
        restore_cmd = (
            f"sudo -u postgres pg_restore -d {shell_quote(db['database'])} "
            f"--clean --if-exists --no-owner --no-privileges {shell_quote(remote_dump)} "
            f"2>/tmp/pg_restore.log; "
            f"tail -20 /tmp/pg_restore.log; "
            f"rm -f {shell_quote(remote_dump)}"
        )
        code, out, err = run(tgt_client, restore_cmd, timeout=1800)
        print(out, end="")
        # pg_restore peut retourner warnings (code 1) — on continue si la DB répond
        code2, out2, _ = run(
            tgt_client,
            f"sudo -u postgres psql -d {shell_quote(db['database'])} -c 'SELECT COUNT(*) FROM admin_settings;' 2>&1",
        )
        print(out2, end="")
        if code2 != 0:
            print("Échec vérification base après restore.", file=sys.stderr)
            sys.exit(1)

        # ── 4. .env + build + service ────────────────────────────────────
        print("==> Écriture .env...")
        env_escaped = env_body.replace("'", "'\"'\"'")
        write_env = f"cat > {shell_quote(tgt_app + '/.env')} << 'ENVEOF'\n{env_body}\nENVEOF\nchmod 600 {shell_quote(tgt_app + '/.env')}"
        code, _, err = run(tgt_client, write_env)
        if code != 0:
            print(err, file=sys.stderr)
            sys.exit(code)

        print("==> pnpm install + build...")
        build_cmd = (
            f"chown -R vouchernet:vouchernet {shell_quote(tgt_app)} 2>/dev/null || true; "
            f"cd {shell_quote(tgt_app)} && "
            f"sudo -u vouchernet bash -lc 'cd {tgt_app} && pnpm install --frozen-lockfile && pnpm build'"
        )
        code, out, err = run(tgt_client, build_cmd, timeout=1800)
        print(out[-4000:] if len(out) > 4000 else out, end="")
        if code != 0:
            print(err[-2000:] if len(err) > 2000 else err, file=sys.stderr)
            sys.exit(code)

        print("==> Démarrage vouchernet...")
        run(tgt_client, "systemctl daemon-reload && systemctl enable vouchernet && systemctl restart vouchernet")
        time.sleep(2)
        code, out, _ = run(tgt_client, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/ || echo 000")
        http_code = out.strip()
        print(f"    HTTP local : {http_code}")

        if domain:
            print(f"==> Nginx / certbot pour {domain}...")
            nginx_cmd = (
                f"cd {shell_quote(tgt_app)} && "
                f"sed -i 's/nanovoucher.com/{domain}/g' /etc/nginx/sites-available/nanovoucher 2>/dev/null; "
                f"nginx -t && systemctl reload nginx; "
                f"certbot --nginx -d {domain} --non-interactive --agree-tos -m admin@{domain} || true"
            )
            run(tgt_client, nginx_cmd, timeout=300)

    finally:
        tgt_client.close()
        if not args.from_local_dump:
            try:
                local_dump.unlink(missing_ok=True)
            except OSError:
                pass

    print("")
    print("Migration terminée.")
    print(f"  Cible : {tgt_host}")
    print(f"  App   : {tgt_app}")
    if domain:
        print(f"  Site  : https://{domain}")
    else:
        print(f"  Test  : http://{tgt_host}:3001 (ou configurez Nginx + DNS)")


if __name__ == "__main__":
    main()
