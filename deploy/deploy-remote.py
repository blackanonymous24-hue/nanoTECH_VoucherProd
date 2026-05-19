#!/usr/bin/env python3
"""Deploiement VPS : lit deploy/vps.local.env et execute update-vps.sh via SSH."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

DEPLOY_DIR = Path(__file__).resolve().parent
REPO_ROOT = DEPLOY_DIR.parent
ENV_FILE = DEPLOY_DIR / "vps.local.env"


def load_env() -> dict[str, str]:
    if not ENV_FILE.is_file():
        print("Fichier manquant:", ENV_FILE, file=sys.stderr)
        sys.exit(1)
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
        return
    except ImportError:
        print("==> Installation de paramiko (une fois)...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])


def main() -> None:
    env = load_env()
    host = env.get("VPS_HOST", "69.62.110.53")
    user = env.get("VPS_USER", "root")
    password = env.get("VPS_SSH_PASSWORD", "")
    port = int(env.get("VPS_PORT", "22"))
    app_dir = env.get("VPS_APP_DIR", "/var/www/vouchernet")

    if not password or password == "CHANGE_ME":
        print("Renseignez VPS_SSH_PASSWORD dans deploy/vps.local.env", file=sys.stderr)
        sys.exit(1)

    ensure_paramiko()
    import paramiko

    cmd = f"cd {app_dir} && sudo bash deploy/update-vps.sh"
    print(f"==> SSH {user}@{host} ...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=30)
    try:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=900)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        if out:
            print(out, end="" if out.endswith("\n") else "\n")
        if err:
            print(err, end="" if err.endswith("\n") else "\n", file=sys.stderr)
        if code != 0:
            print(f"Echec distant (code {code})", file=sys.stderr)
            sys.exit(code)
    finally:
        client.close()

    print("Deploiement termine - https://nanovoucher.com")


if __name__ == "__main__":
    main()
