#!/usr/bin/env python3
"""Inspect nginx + DNS issue on both VPS."""
import re
import subprocess
import sys
from pathlib import Path

DEPLOY = Path(__file__).resolve().parent

def load(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line.strip())
        if m and not line.strip().startswith("#"):
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out

def run_ssh(host, user, password, port, cmd):
    try:
        import paramiko
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])
        import paramiko
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(host, port=port, username=user, password=password, timeout=30)
    _, stdout, stderr = c.exec_command(cmd, timeout=60)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    code = stdout.channel.recv_exit_status()
    c.close()
    return code, out, err

def main():
    new = load(DEPLOY / "vps.local.env")
    old = load(DEPLOY / "vps.old.local.env")

    for label, env, hkey, pkey in [
        ("NOUVEAU", new, "VPS_HOST", "VPS_SSH_PASSWORD"),
        ("ANCIEN", old, "OLD_VPS_HOST", "OLD_VPS_SSH_PASSWORD"),
    ]:
        host = env[hkey]
        pw = env[pkey]
        print(f"\n========== {label} {host} ==========")
        cmd = """
echo '--- sites-enabled ---'
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || true
echo '--- server_name ---'
grep -rh server_name /etc/nginx/sites-enabled/ /etc/nginx/sites-available/ 2>/dev/null | head -20
echo '--- vouchernet ---'
systemctl is-active vouchernet 2>/dev/null || echo inactive
curl -s -o /dev/null -w 'local3001:%{http_code}\\n' http://127.0.0.1:3001/ 2>/dev/null || echo local3001:fail
echo '--- curl Host nanovoucher ---'
curl -sI -H 'Host: nanovoucher.com' http://127.0.0.1/ 2>/dev/null | head -8
curl -sI -H 'Host: www.nanovoucher.com' http://127.0.0.1/ 2>/dev/null | head -8
"""
        code, out, err = run_ssh(host, "root", pw, 22, cmd)
        print(out)
        if err:
            print(err, file=sys.stderr)

if __name__ == "__main__":
    main()
