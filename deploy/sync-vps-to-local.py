#!/usr/bin/env python3
"""
Copie la base PostgreSQL du VPS de production vers Postgres local (Docker).

Prérequis : Docker démarré, deploy/vps.local.env renseigné.

Usage :
  python deploy/sync-vps-to-local.py
  pnpm run db:sync-vps-local

Produit :
  - backups/vouchernet-vps-latest.dump  (à réutiliser pour migrate-full-vps.py / autre VPS)
  - backups/vouchernet-vps-YYYYMMDD.dump
  - .env.local avec DATABASE_URL locale (port 5434)
"""
from __future__ import annotations

import re
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
DEPLOY = Path(__file__).resolve().parent
ENV_FILE = DEPLOY / "vps.local.env"
BACKUPS = REPO / "backups"

NETWORK = "vouchernet-sync-net"
CONTAINER = "vouchernet-preview-pg"
LOCAL_PORT = "5434"
LOCAL_USER = "vouchernet"
LOCAL_PASS = "vouchernet"
LOCAL_DB = "vouchernet_preview"
REMOTE_DUMP = "/tmp/vouchernet_sync_local.dump"


def load_env(path: Path) -> dict[str, str]:
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
        subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])


def docker(args: list[str], *, inherit: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["docker", *args],
        cwd=REPO,
        capture_output=not inherit,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def fail(msg: str, detail: str = "") -> None:
    print(msg, file=sys.stderr)
    if detail:
        print(detail, file=sys.stderr)
    sys.exit(1)


def fetch_env_from_vps(host: str, user: str, password: str, port: int, app_dir: str) -> str:
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=60)
    try:
        _, stdout, _ = client.exec_command(f"cat {app_dir}/.env 2>/dev/null", timeout=30)
        body = stdout.read().decode(errors="replace")
        if not body.strip():
            fail(".env introuvable sur le VPS.")
        env_backup = BACKUPS / "vouchernet-vps-production.env"
        env_backup.write_text(body, encoding="utf-8")
        print(f"==> .env production sauvegardé -> {env_backup.relative_to(REPO)}")
        return body
    finally:
        client.close()


def dump_from_vps(host: str, user: str, password: str, port: int, app_dir: str) -> None:
    import paramiko

    print(f"==> Dump PostgreSQL sur {host}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=60)
    try:
        cmd = (
            f"sudo -u postgres pg_dump -Fc vouchernet -f {REMOTE_DUMP} "
            f"&& ls -lh {REMOTE_DUMP}"
        )
        _, stdout, stderr = client.exec_command(cmd, timeout=1800)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        print(out, end="")
        if code != 0:
            fail("pg_dump sur le VPS a échoué.", err)

        BACKUPS.mkdir(parents=True, exist_ok=True)
        dated = BACKUPS / f"vouchernet-vps-{date.today().isoformat()}.dump"
        latest = BACKUPS / "vouchernet-vps-latest.dump"
        for target in (dated, latest):
            print(f"==> Téléchargement -> {target.relative_to(REPO)}")
            sftp = client.open_sftp()
            try:
                sftp.get(REMOTE_DUMP, str(target))
            finally:
                sftp.close()
        client.exec_command(f"rm -f {REMOTE_DUMP}")
        size_mb = latest.stat().st_size / 1024 / 1024
        print(f"    Sauvegarde : {size_mb:.2f} MiB")
    finally:
        client.close()


def setup_local_postgres() -> None:
    dv = docker(["version"])
    if dv.returncode != 0:
        fail("Docker indisponible. Démarrez Docker Desktop puis réessayez.", dv.stderr or "")

    print("==> Réseau Docker...")
    if docker(["network", "inspect", NETWORK]).returncode != 0:
        if docker(["network", "create", NETWORK]).returncode != 0:
            fail("Impossible de créer le réseau Docker.")

    print("==> Postgres local (preview)...")
    docker(["rm", "-f", CONTAINER])
    run = docker(
        [
            "run",
            "-d",
            "--name",
            CONTAINER,
            "--network",
            NETWORK,
            "-e",
            f"POSTGRES_USER={LOCAL_USER}",
            "-e",
            f"POSTGRES_PASSWORD={LOCAL_PASS}",
            "-e",
            f"POSTGRES_DB={LOCAL_DB}",
            "-p",
            f"{LOCAL_PORT}:5432",
            "postgres:16-alpine",
        ]
    )
    if run.returncode != 0:
        fail("Impossible de démarrer le conteneur Postgres.", run.stderr or "")

    for i in range(90):
        if docker(["exec", CONTAINER, "pg_isready", "-U", LOCAL_USER, "-d", LOCAL_DB]).returncode == 0:
            # pg_isready OK ≠ acceptation TCP depuis un autre conteneur — petite pause
            time.sleep(2)
            break
        time.sleep(1)
    else:
        fail("Timeout : Postgres local ne répond pas.")


def restore_dump(dump_path: Path) -> None:
    mount = dump_path.resolve().as_posix()
    inner = (
        f"pg_restore -h {CONTAINER} -p 5432 -U {LOCAL_USER} -d {LOCAL_DB} "
        f"--no-owner --no-acl /work/dump.fc"
    )
    print("==> pg_restore vers Postgres local...")
    r = docker(
        [
            "run",
            "--rm",
            "--network",
            NETWORK,
            "-v",
            f"{mount}:/work/dump.fc:ro",
            "-e",
            f"PGPASSWORD={LOCAL_PASS}",
            "postgres:16-alpine",
            "sh",
            "-c",
            inner,
        ],
        inherit=True,
    )
    if r.returncode not in (0, 1):
        fail("pg_restore a échoué.")
    if dump_path.stat().st_size < 1024:
        fail("Fichier dump vide ou trop petit.")

    verify = docker(
        [
            "exec",
            CONTAINER,
            "psql",
            "-U",
            LOCAL_USER,
            "-d",
            LOCAL_DB,
            "-tAc",
            "SELECT COUNT(*) FROM admin_settings;",
        ]
    )
    count = (verify.stdout or "").strip()
    if verify.returncode != 0 or not count.isdigit() or int(count) < 1:
        fail(
            "Restauration invalide (admin_settings vide). Relancez le script ou vérifiez Docker.",
            verify.stderr or "",
        )
    print(f"    Vérification : {count} ligne(s) dans admin_settings")


def write_env_local() -> None:
    local_url = (
        f"postgresql://{LOCAL_USER}:{LOCAL_PASS}@127.0.0.1:{LOCAL_PORT}/{LOCAL_DB}"
        "?sslmode=disable"
    )
    body = (
        "# Généré par pnpm run db:sync-vps-local — copie production VPS → Postgres Docker local.\n"
        "# Dump réutilisable : backups/vouchernet-vps-latest.dump (autre VPS : migrate-full-vps.py)\n"
        f"DATABASE_URL={local_url}\n"
    )
    path = REPO / ".env.local"
    path.write_text(body, encoding="utf-8")
    print(f"==> {path.relative_to(REPO)} mis à jour (DATABASE_URL locale)")


def main() -> None:
    if not ENV_FILE.is_file():
        fail(f"Créez {ENV_FILE.relative_to(REPO)} (copie de deploy/vps.local.env.example).")

    env = load_env(ENV_FILE)
    host = env.get("VPS_HOST", "")
    user = env.get("VPS_USER", "root")
    password = env.get("VPS_SSH_PASSWORD", "")
    port = int(env.get("VPS_PORT", "22"))
    app_dir = env.get("VPS_APP_DIR", "/var/www/vouchernet")

    if not host or not password:
        fail("Renseignez VPS_HOST et VPS_SSH_PASSWORD dans deploy/vps.local.env.")

    ensure_paramiko()
    fetch_env_from_vps(host, user, password, port, app_dir)
    dump_from_vps(host, user, password, port, app_dir)
    setup_local_postgres()
    restore_dump(BACKUPS / "vouchernet-vps-latest.dump")
    write_env_local()

    print("")
    print("Terminé.")
    print(f"  Dev local : DATABASE_URL → 127.0.0.1:{LOCAL_PORT}/{LOCAL_DB}")
    print(f"  Backup    : backups/vouchernet-vps-latest.dump")
    print("  Autre VPS : python deploy/migrate-full-vps.py (après config vps.target.local.env)")


if __name__ == "__main__":
    main()
