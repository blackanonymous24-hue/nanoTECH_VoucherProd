#!/usr/bin/env python3
"""
Réapplique host/port des routeurs depuis Postgres local (dump VPS sync) vers la prod.
Ne modifie pas les comptes — uniquement routers.host et routers.port par id.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEPLOY_DIR = Path(__file__).resolve().parent
ENV_FILE = DEPLOY_DIR / "vps.local.env"
CONTAINER = "vouchernet-preview-pg"
LOCAL_DB = "vouchernet_preview"


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
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


def local_router_rows() -> list[tuple[int, str, int]]:
    r = subprocess.run(
        [
            "docker", "exec", CONTAINER,
            "psql", "-U", "vouchernet", "-d", LOCAL_DB,
            "-t", "-A", "-F", "|",
            "-c", "SELECT id, host, port FROM routers ORDER BY id",
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if r.returncode != 0:
        print(r.stderr, file=sys.stderr)
        sys.exit(1)
    rows: list[tuple[int, str, int]] = []
    for line in r.stdout.strip().splitlines():
        if not line.strip():
            continue
        parts = line.split("|")
        if len(parts) < 3:
            continue
        rows.append((int(parts[0]), parts[1].strip(), int(parts[2])))
    return rows


def main() -> None:
    env = load_env()
    password = env.get("VPS_SSH_PASSWORD", "")
    host = env.get("VPS_HOST")
    user = env.get("VPS_USER", "root")
    port = int(env.get("VPS_PORT", "22"))
    if not password:
        print("VPS_SSH_PASSWORD manquant", file=sys.stderr)
        sys.exit(1)

    rows = local_router_rows()
    if not rows:
        print("Aucun routeur en local — lancez docker start vouchernet-preview-pg et db:sync-vps-local", file=sys.stderr)
        sys.exit(1)

    print(f"==> {len(rows)} routeurs lus depuis Postgres local")

    ensure_paramiko()
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=30)
    try:
        updated = 0
        for rid, h, p in rows:
            h_esc = h.replace("'", "''")
            sql = f"UPDATE routers SET host = '{h_esc}', port = {p} WHERE id = {rid}"
            _, stdout, stderr = client.exec_command(
                f"sudo -u postgres psql -d vouchernet -v ON_ERROR_STOP=1 -c {sql!r}",
                timeout=30,
            )
            code = stdout.channel.recv_exit_status()
            if code != 0:
                print(stderr.read().decode(errors="replace"), file=sys.stderr)
                sys.exit(code)
            updated += 1

        print(f"==> {updated} lignes mises à jour sur le VPS")
        _, stdout, _ = client.exec_command(
            "sudo -u postgres psql -d vouchernet -t -A -c \"SELECT port, count(*) FROM routers GROUP BY port ORDER BY port;\"",
            timeout=30,
        )
        print(stdout.read().decode(errors="replace"))

        print("==> Redémarrage vouchernet")
        _, stdout, _ = client.exec_command("systemctl restart vouchernet && sleep 2 && systemctl is-active vouchernet", timeout=30)
        print(stdout.read().decode(errors="replace"))
    finally:
        client.close()


if __name__ == "__main__":
    main()
