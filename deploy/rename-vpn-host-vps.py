#!/usr/bin/env python3
"""Migration ponctuelle : vpn.nanotechvpn.com → wg.nanotechvpn.com (tous les routeurs en base)."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ENV_FILE = Path(__file__).resolve().parent / "vps.local.env"


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


def main() -> None:
    env = load_env()
    password = env.get("VPS_SSH_PASSWORD", "")
    host = env.get("VPS_HOST")
    user = env.get("VPS_USER", "root")
    port = int(env.get("VPS_PORT", "22"))
    if not password:
        print("VPS_SSH_PASSWORD manquant", file=sys.stderr)
        sys.exit(1)
    ensure_paramiko()
    import paramiko

    sql = "UPDATE routers SET host = 'wg.nanotechvpn.com' WHERE host = 'vpn.nanotechvpn.com';"
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=30)
    try:
        _, stdout, stderr = client.exec_command(
            f"sudo -u postgres psql -d vouchernet -v ON_ERROR_STOP=1 -c {sql!r}",
            timeout=60,
        )
        print(stdout.read().decode(errors="replace"))
        err = stderr.read().decode(errors="replace")
        if err.strip():
            print(err, file=sys.stderr)
        _, stdout, _ = client.exec_command(
            "sudo -u postgres psql -d vouchernet -t -A -c \"SELECT count(*) FROM routers WHERE host = 'wg.nanotechvpn.com';\"",
            timeout=30,
        )
        print("Routeurs wg.nanotechvpn.com:", stdout.read().decode(errors="replace").strip())
        client.exec_command("systemctl restart vouchernet", timeout=30)
        print("Service vouchernet redémarré.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
