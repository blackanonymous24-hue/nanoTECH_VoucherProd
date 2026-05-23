#!/usr/bin/env python3
"""Répare la base production VPS (colonnes manquantes). Ne touche pas aux comptes."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEPLOY_DIR = Path(__file__).resolve().parent
ENV_FILE = DEPLOY_DIR / "vps.local.env"

SQL = r"""
ALTER TABLE routers
  ADD COLUMN IF NOT EXISTS timezone_offset_minutes integer NOT NULL DEFAULT 0;

"""


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
    host = env.get("VPS_HOST")
    password = env.get("VPS_SSH_PASSWORD", "")
    user = env.get("VPS_USER", "root")
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
        print("==> Sauvegarde rapide (pg_dump routers + admin_settings)")
        _, stdout, _ = client.exec_command(
            "sudo -u postgres pg_dump -d vouchernet -t routers -t admin_settings -t vendors -t managers -t collaborateurs -Fc -f /tmp/vouchernet-accounts-backup.dump && ls -la /tmp/vouchernet-accounts-backup.dump",
            timeout=120,
        )
        print(stdout.read().decode(errors="replace"))

        print("==> Migration SQL (routers + schéma)")
        for stmt in (
            "ALTER TABLE routers ADD COLUMN IF NOT EXISTS timezone_offset_minutes integer NOT NULL DEFAULT 0",
            "ALTER TABLE routers ADD COLUMN IF NOT EXISTS mikrotik_serial text",
            "ALTER TABLE routers ADD COLUMN IF NOT EXISTS auto_delete_sales_scripts boolean NOT NULL DEFAULT false",
            "ALTER TABLE routers ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'FCFA'",
            "ALTER TABLE routers ADD COLUMN IF NOT EXISTS owner_admin_id integer",
        ):
            _, stdout, stderr = client.exec_command(
                f"sudo -u postgres psql -d vouchernet -v ON_ERROR_STOP=1 -c {stmt!r}",
                timeout=60,
            )
            out = stdout.read().decode(errors="replace")
            err = stderr.read().decode(errors="replace")
            print(out or err)

        print("==> Propriété des tables → vouchernet (restauration dump postgres)")
        _, stdout, stderr = client.exec_command(
            r"""sudo -u postgres psql -d vouchernet -v ON_ERROR_STOP=1 <<'EOSQL'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO vouchernet', r.tablename);
  END LOOP;
  FOR r IN
    SELECT c.relname AS seqname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO vouchernet', r.seqname);
  END LOOP;
END $$;
ALTER SCHEMA public OWNER TO vouchernet;
EOSQL
""",
            timeout=120,
        )
        print(stdout.read().decode(errors="replace") or stderr.read().decode(errors="replace"))

        print("==> Colonnes admin_settings manquantes (propriétaire postgres)")
        for stmt in (
            "ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS print_scale_web integer",
            "ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS print_scale_mobile integer",
            "ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS print_scales text",
            "ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0",
            "ALTER TABLE vendors ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0",
            "ALTER TABLE managers ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0",
            "ALTER TABLE collaborateurs ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0",
        ):
            _, stdout, stderr = client.exec_command(
                f"sudo -u postgres psql -d vouchernet -v ON_ERROR_STOP=1 -c {stmt!r}",
                timeout=60,
            )
            out = stdout.read().decode(errors="replace")
            err = stderr.read().decode(errors="replace")
            if "already exists" in (out + err).lower() or "ALTER TABLE" in out:
                print(stmt.split()[2], "OK")
            elif err.strip():
                print(stmt, err.strip()[:200])

        print("==> drizzle-kit push (schéma complet, sans données comptes)")
        _, stdout, stderr = client.exec_command(
            f"sudo -u vouchernet bash -lc 'cd /var/www/vouchernet && pnpm --filter @workspace/db exec drizzle-kit push 2>&1' | tail -25",
            timeout=300,
        )
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        if out.strip():
            print(out)
        if err.strip():
            print("stderr:", err[:500])

        print("==> Vérification")
        _, stdout, _ = client.exec_command(
            "sudo -u postgres psql -d vouchernet -t -A -c \"SELECT column_name FROM information_schema.columns WHERE table_name='routers' AND column_name IN ('timezone_offset_minutes','mikrotik_serial') ORDER BY 1;\" && "
            "sudo -u postgres psql -d vouchernet -t -A -c \"SELECT port, count(*) FROM routers GROUP BY port ORDER BY port;\" && "
            "sudo -u postgres psql -d vouchernet -t -A -c \"SELECT id, host, port FROM routers WHERE host LIKE '%mikroot%' LIMIT 5;\"",
            timeout=30,
        )
        print(stdout.read().decode(errors="replace"))

        print("==> Redémarrage vouchernet")
        _, stdout, _ = client.exec_command("systemctl restart vouchernet && sleep 2 && systemctl is-active vouchernet", timeout=30)
        print(stdout.read().decode(errors="replace"))
        print("Terminé — comptes et données métier conservés (dump dans /tmp/vouchernet-accounts-backup.dump sur le VPS).")
    finally:
        client.close()


if __name__ == "__main__":
    main()
