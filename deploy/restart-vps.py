#!/usr/bin/env python3
"""Redémarre le service vouchernet sur le VPS."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import paramiko

DEPLOY_DIR = Path(__file__).resolve().parent
ENV_FILE = DEPLOY_DIR / "vps.local.env"


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


def main() -> None:
    env = load_env()
    host = env.get("VPS_HOST", "69.62.110.53")
    user = env.get("VPS_USER", "root")
    password = env.get("VPS_SSH_PASSWORD", "")
    port = int(env.get("VPS_PORT", "22"))

    if not password or password == "CHANGE_ME":
        print("Renseignez VPS_SSH_PASSWORD dans deploy/vps.local.env", file=sys.stderr)
        sys.exit(1)

    print(f"==> SSH {user}@{host} — restart vouchernet")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=30)
    try:
        for cmd in (
            "systemctl restart vouchernet",
            "sleep 2",
            "systemctl is-active vouchernet",
            "systemctl status vouchernet --no-pager -l | head -n 12",
            'curl -s -o /dev/null -w "HTTP %{http_code}" http://127.0.0.1:3001/ || echo "local check failed"',
        ):
            print(f"==> {cmd}")
            _, stdout, stderr = client.exec_command(cmd, timeout=60)
            out = stdout.read().decode("utf-8", errors="replace").strip()
            err = stderr.read().decode("utf-8", errors="replace").strip()
            if out:
                print(out)
            if err:
                print(err, file=sys.stderr)
    finally:
        client.close()

    print("Redémarrage terminé — https://nanovoucher.com")


if __name__ == "__main__":
    main()
