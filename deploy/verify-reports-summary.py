"""Verify /vendors/reports/summary returns non-zero week/lastWeek/lastMonth fields."""
from __future__ import annotations
import io, sys, json, urllib.request, urllib.error, ssl
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)

env = {}
for line in (Path(__file__).resolve().parent / "vps.local.env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k, _, v = line.partition("=")
    env[k.strip()] = v.strip()

BASE = "https://nanovoucher.com"
USER = env.get("LOGIN_TEST_USER", "admin")
PASS = env.get("LOGIN_TEST_PASS", "")
ctx = ssl.create_default_context()

# Login
req = urllib.request.Request(f"{BASE}/api/auth/login",
    data=json.dumps({"username": USER, "password": PASS}).encode("utf-8"),
    headers={"Content-Type": "application/json"})
try:
    resp = urllib.request.urlopen(req, context=ctx, timeout=20)
    cookie = resp.headers.get("Set-Cookie", "").split(";")[0]
    print(f"login: {resp.status} cookie={cookie[:60]}")
except urllib.error.HTTPError as e:
    print(f"login failed: {e.code} {e.read().decode(errors='replace')[:200]}")
    sys.exit(1)

# Try router 1
for rid in [1]:
    req = urllib.request.Request(f"{BASE}/api/vendors/reports/summary?routerId={rid}",
        headers={"Cookie": cookie})
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=30)
        rows = json.loads(resp.read().decode("utf-8"))
        print(f"\n== router {rid}: {len(rows)} vendors ==")
        for r in rows:
            v = r.get("vendor", {})
            ss = r.get("salesStats", {})
            print(f"  vendor {v.get('id'):>3} {v.get('name'):20} → today={ss.get('todaySold'):4} yest={ss.get('yesterdaySold'):4} week={ss.get('weekSold'):4} lastWeek={ss.get('lastWeekSold'):4} month={ss.get('thisMonthSold'):5} lastMonth={ss.get('lastMonthSold'):4}")
    except urllib.error.HTTPError as e:
        print(f"router {rid} failed: {e.code}")
