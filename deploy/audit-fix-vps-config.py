#!/usr/bin/env python3
"""
Audit + réparation config VPS production (sans toucher aux comptes admin/gérant/collab).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import paramiko

DEPLOY_DIR = Path(__file__).resolve().parent
APP_DIR = "/var/www/vouchernet"
REQUIRED_ENV_KEYS = ("NODE_ENV", "PORT", "DATABASE_URL", "SESSION_SECRET")


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in (DEPLOY_DIR / "vps.local.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> tuple[str, str, int]:
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    return (
        stdout.read().decode("utf-8", errors="replace"),
        stderr.read().decode("utf-8", errors="replace"),
        code,
    )


def main() -> None:
    env = load_env()
    host = env.get("VPS_HOST", "")
    print(f"==> Connexion {env.get('VPS_USER', 'root')}@{host}")

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        host,
        port=int(env.get("VPS_PORT", "22")),
        username=env.get("VPS_USER", "root"),
        password=env["VPS_SSH_PASSWORD"],
        timeout=30,
    )

    fixes: list[str] = []

    checks = [
        ("Hostname", "hostname -f; uptime"),
        ("Service vouchernet", "systemctl is-active vouchernet 2>&1; systemctl status vouchernet --no-pager -n 8 2>&1 | head -15"),
        ("API local", "curl -sf -o /dev/null -w 'api:%{http_code}\\n' http://127.0.0.1:3001/ 2>&1 || echo api:FAIL"),
        ("Nginx sites", "ls -la /etc/nginx/sites-enabled/ 2>&1"),
        ("Nginx test", "nginx -t 2>&1"),
        ("Site HTTP", "curl -sf -o /dev/null -w 'nginx:%{http_code}\\n' -H 'Host: nanovoucher.com' http://127.0.0.1/ 2>&1 || echo nginx:FAIL"),
        ("Git HEAD", f"cd {APP_DIR} && git log -1 --oneline 2>&1"),
        (".env keys (masqué)", f"""bash -lc 'cd {APP_DIR} && if [ -f .env ]; then
  for k in NODE_ENV PORT DATABASE_URL SESSION_SECRET; do
    if grep -qE "^$k=" .env; then echo "$k=SET"; else echo "$k=MISSING"; fi
  done
  grep -qE "^DATABASE_URL=postgresql://" .env && echo "DATABASE_URL_FORMAT=ok" || echo "DATABASE_URL_FORMAT=bad"
  grep -q "^SESSION_SECRET=changez" .env && echo "SESSION_SECRET=DEFAULT_UNSAFE" || echo "SESSION_SECRET=custom"
else echo ".env=MISSING_FILE"; fi'"""),
        ("PostgreSQL", "systemctl is-active postgresql 2>&1 || systemctl is-active postgresql@* 2>&1 | head -3"),
        ("Comptes (conservés)", """sudo -u postgres psql -d vouchernet -t -A -c "
SELECT 'admin_settings' AS t, count(*)::text FROM admin_settings
UNION ALL SELECT 'managers', count(*)::text FROM managers
UNION ALL SELECT 'collaborateurs', count(*)::text FROM collaborateurs
UNION ALL SELECT 'vendors', count(*)::text FROM vendors
UNION ALL SELECT 'routers', count(*)::text FROM routers;
" 2>&1"""),
        ("PM2 (ne doit pas remplacer systemd)", "pm2 list 2>/dev/null | head -8 || echo 'pm2:absent'"),
    ]

    for title, cmd in checks:
        print(f"\n--- {title} ---")
        out, err, code = run(c, cmd)
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print("stderr:", err.rstrip()[:500])

    # --- Réparations automatiques ---
    print("\n==> Réparations")

    # 1) Nginx : site nanovoucher actif
    out, _, _ = run(c, "test -f /etc/nginx/sites-available/nanovoucher && echo yes || echo no")
    if "yes" in out:
        out2, err2, code2 = run(c, f"""
if [ ! -L /etc/nginx/sites-enabled/nanovoucher ]; then
  ln -sf /etc/nginx/sites-available/nanovoucher /etc/nginx/sites-enabled/nanovoucher
  echo FIXED_NGINX_LINK
fi
nginx -t 2>&1 && systemctl reload nginx && echo NGINX_RELOAD_OK
""")
        print(out2, err2)
        if "FIXED_NGINX_LINK" in out2:
            fixes.append("nginx: lien sites-enabled/nanovoucher")

    # 2) Service systemd vouchernet (fichier unit)
    out, _, _ = run(c, f"test -f {APP_DIR}/deploy/vouchernet.service && echo yes || echo no")
    if "yes" in out:
        run(c, f"""
if [ ! -f /etc/systemd/system/vouchernet.service ] || ! diff -q {APP_DIR}/deploy/vouchernet.service /etc/systemd/system/vouchernet.service >/dev/null 2>&1; then
  cp {APP_DIR}/deploy/vouchernet.service /etc/systemd/system/vouchernet.service
  systemctl daemon-reload
  echo UNIT_UPDATED
fi
""")
        out3, _, _ = run(c, "systemctl enable vouchernet 2>&1; systemctl restart vouchernet; sleep 3; systemctl is-active vouchernet")
        print("vouchernet:", out3.strip())
        fixes.append("systemd: vouchernet redémarré")

    # 3) .env : clés manquantes uniquement (ne pas écraser secrets existants)
    out, _, _ = run(c, f"""bash -lc 'cd {APP_DIR} && missing=""
for k in NODE_ENV PORT DATABASE_URL SESSION_SECRET; do
  grep -qE "^$k=" .env 2>/dev/null || missing="$missing $k"
done
echo "$missing"'""")
    missing = [x for x in out.strip().split() if x]
    if missing:
        print("Clés .env manquantes:", missing)
        print("ATTENTION: réparation .env manuelle requise — secrets non devinables automatiquement.")
    else:
        print(".env: clés obligatoires présentes")

    # 4) Permissions .env
    run(c, f"bash -lc 'cd {APP_DIR} && [ -f .env ] && chmod 600 .env && chown vouchernet:vouchernet .env && ls -la .env'")

    # 5) Vérif finale
    print("\n==> Vérification finale")
    out, _, _ = run(c, "curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/ && echo")
    print("API:", out.strip())
    out2, _, _ = run(c, "curl -sf -o /dev/null -w '%{http_code}' -H 'Host: nanovoucher.com' http://127.0.0.1/ && echo")
    print("Nginx:", out2.strip())

    c.close()
    print("\nRésumé fixes:", fixes or "aucune (config déjà OK)")


if __name__ == "__main__":
    main()
