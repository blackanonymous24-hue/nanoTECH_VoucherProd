#!/usr/bin/env python3
"""Diagnostic VPS : liste les services, sites Nginx, ports ecoutes, postgres et processus node."""
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


def ensure_paramiko():
    try:
        import paramiko  # noqa: F401
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])


CMDS = [
    ("== conf nginx nanotech-vpn ==",
     "cat /etc/nginx/sites-available/nanotech-vpn 2>/dev/null"),
    ("== service systemd nanotech-vpn ==",
     "cat /etc/systemd/system/nanotech-vpn.service 2>/dev/null"),
    ("== dossier nanotech-vpn ==",
     "ls -la /home/nanotech/ 2>/dev/null | head -25; echo '---'; for d in /var/www/nanotech-vpn /opt/nanotech-vpn /root/nanotech-vpn; do [ -d \"$d\" ] && ls -la \"$d\" | head -20; done"),
    ("== redemarrage vouchernet/nginx (7j) ==",
     "journalctl -u vouchernet --since '7d ago' --no-pager 2>/dev/null | grep -iE 'started|stopped|killed' | tail -25; echo '---'; journalctl -u nginx --since '7d ago' --no-pager 2>/dev/null | grep -iE 'reload|reopen|restart|start|stop' | tail -25"),
    ("== redemarrage nanotech-vpn (7j) ==",
     "journalctl -u nanotech-vpn --since '7d ago' --no-pager 2>/dev/null | grep -iE 'started|stopped|killed' | tail -25"),
    ("== service status nanotech-vpn ==",
     "systemctl status nanotech-vpn --no-pager -n 5 2>&1 | head -20"),
    ("== certbot timers / hooks ==",
     "ls /etc/letsencrypt/renewal/ 2>/dev/null; echo '---'; systemctl list-timers --all 2>/dev/null | grep -i certbot"),
]


def main() -> None:
    env = load_env()
    host = env.get("VPS_HOST")
    user = env.get("VPS_USER", "root")
    password = env.get("VPS_SSH_PASSWORD", "")
    port = int(env.get("VPS_PORT", "22"))
    if not password:
        print("VPS_SSH_PASSWORD manquant", file=sys.stderr)
        sys.exit(1)
    ensure_paramiko()
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=30)
    try:
        for title, cmd in CMDS:
            print(f"\n{title}")
            _, stdout, stderr = client.exec_command(cmd, timeout=60)
            out = stdout.read().decode(errors="replace")
            err = stderr.read().decode(errors="replace")
            if out.strip():
                print(out.rstrip())
            if err.strip():
                print("(stderr)", err.rstrip())
    finally:
        client.close()


if __name__ == "__main__":
    main()
