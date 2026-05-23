"""Login as ADJARA (vendor 5, daily) and dump /me/daily-arrears + /me/payments."""
from __future__ import annotations
import io, sys, json, urllib.request, urllib.error, ssl
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)

BASE = "https://nanovoucher.com"
ctx = ssl.create_default_context()

def req(path, method="GET", body=None, headers=None):
    h = {"Content-Type": "application/json"}
    if headers: h.update(headers)
    data = json.dumps(body).encode("utf-8") if body else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r, context=ctx, timeout=20)
        return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:600]

# Login as ADJARA (vendor 5, daily, rate 20%)
for vid, username in [(5, "0101718683"), (3, "0767844233"), (6, "0595850918")]:
    print(f"\n=================== vendor {vid} ({username}) ===================")
    status, body = req("/api/vendor-portal/login", "POST", {"username": username, "password": "1234"})
    print(f"login {status}")
    if status != 200 or not isinstance(body, dict) or not body.get("token"):
        print(f"  body: {str(body)[:200]}")
        continue
    token = body["token"]
    auth = {"Authorization": f"Bearer {token}"}

    s2, b2 = req("/api/vendor-portal/me/daily-arrears", headers=auth)
    print(f"\n  /me/daily-arrears → {s2}")
    if isinstance(b2, dict):
        days = b2.get("days", [])
        print(f"    days count: {len(days)}")
        for d in days[:8]:
            print(f"      {d.get('date')}: sold={d.get('count')} amount={d.get('amount')} paid={d.get('paid')} remaining={d.get('remaining')}")
    else:
        print(f"    body: {str(b2)[:300]}")

    s3, b3 = req("/api/vendor-portal/me/payments", headers=auth)
    print(f"\n  /me/payments → {s3}")
    if isinstance(b3, dict):
        for w in b3.get("weeks", []):
            print(f"      week {w.get('weekStart')}: sold={w.get('count')} amount={w.get('amount')} due_remaining={w.get('remaining')} carry={w.get('carryOverFromPriorWeeks')} weeklyPaid={w.get('weeklyPaid')} dailyPaid={w.get('dailyPaid')}")
    else:
        print(f"    body: {str(b3)[:300]}")
