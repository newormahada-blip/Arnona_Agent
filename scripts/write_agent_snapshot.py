"""
write_agent_snapshot.py
Writes reports/agent_snapshot.json: what the scanning agent must know before it
adds a business — the businesses already in the system and the closed list of
business types. The agent can't reach the database during a run, so the GitHub
workflow (which can) refreshes this file after every upload.

Usage (env SUPABASE_URL, SUPABASE_KEY):
  python scripts/write_agent_snapshot.py [--out reports/agent_snapshot.json]
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arnona_common import fetch_all, business_key, address_key

parser = argparse.ArgumentParser()
parser.add_argument("--out", default="reports/agent_snapshot.json")
args = parser.parse_args()

URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_KEY"]
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

businesses = fetch_all(URL, HEADERS, "businesses", "name,address,type")
types = sorted({t["name"] for t in fetch_all(URL, HEADERS, "business_types", "name", order="name") if t.get("name")})

snapshot = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "how_to_use": "Before adding a business: skip it if business_key(name, address) is in `keys`, "
                  "or looks_like_same_business() matches a row at the same address_key "
                  "(scripts/arnona_common.py). Pick `type` from `business_types`; only if none fits, write a new one.",
    "business_types": types,
    "keys": sorted({business_key(b["name"] or "", b["address"] or "") for b in businesses}),
    "businesses": sorted(
        ({"name": b["name"], "address": b["address"], "type": b.get("type") or "",
          "address_key": address_key(b["address"] or "")} for b in businesses),
        key=lambda b: (b["address_key"], b["name"] or ""),
    ),
}

os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
with open(args.out, "w", encoding="utf-8") as f:
    json.dump(snapshot, f, ensure_ascii=False, indent=1)
print(f"Wrote {args.out}: {len(businesses)} businesses, {len(types)} business types")
