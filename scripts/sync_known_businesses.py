#!/usr/bin/env python3
"""
sync_known_businesses.py — run by the "Game" routine (repo Final_Project) at
the start of every run, BEFORE the first search:

  curl -sfo /tmp/sync_known.py https://raw.githubusercontent.com/urbandetective007/Arnona_Agent/main/scripts/sync_known_businesses.py
  python3 /tmp/sync_known.py known_businesses

Adds to known_businesses/known_businesses.xlsx every business that is in the
system (Supabase, via reports/agent_snapshot.json, refreshed every 3 hours by
.github/workflows/upload-arnona.yml) and not yet in the list, with מקור
"מערכת (אתר)". The routine's own matching (known_businesses.py find_match) is
used, so a business already listed under another spelling is not added twice.
Also writes known_businesses/business_types.txt — the closed list of business
types the routine picks from.

Without it the list knew only what was in the system on 14-10-2026 plus the
routine's own finds, so businesses uploaded later (or lost when a run was cut
before its STEP 3) were found and reported again.
"""
import json
import os
import sys
import urllib.request
from datetime import date

SNAPSHOT_URL = "https://raw.githubusercontent.com/urbandetective007/Arnona_Agent/main/reports/agent_snapshot.json"
SOURCE = "מערכת (אתר)"


def main():
    folder = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "known_businesses")
    sys.path.insert(0, folder)
    import known_businesses as kb  # the routine's own module: same matching as `check`

    try:
        if os.environ.get("AGENT_SNAPSHOT_FILE"):  # local testing
            snap = json.load(open(os.environ["AGENT_SNAPSHOT_FILE"], encoding="utf-8"))
        else:
            with urllib.request.urlopen(SNAPSHOT_URL, timeout=30) as r:
                snap = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001 — any failure: keep the list as it is
        print(f"⚠️ SYNC FAILED — could not read the system's businesses ({e}). "
              f"The duplicate check uses the existing list only. Write this in the draft.")
        sys.exit(0)

    known = kb.load_known()
    added = 0
    for b in snap.get("businesses", []):
        name, address = (b.get("name") or "").strip(), (b.get("address") or "").strip()
        if not name or not address:
            continue
        if kb.find_match(name, address, known)[1] == "same_address":
            continue
        known.append({"שם העסק": name, "כתובת": address, "שכונה": None, "סוג עסק": b.get("type") or None,
                      "קישור": None, "מקור": SOURCE, "תאריך הוספה": date.today().isoformat()})
        added += 1
    if added:
        kb.save_known(known)

    types = snap.get("business_types", [])
    with open(os.path.join(folder, "business_types.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(types) + "\n")

    print(f"✅ SYNC: system snapshot of {snap.get('generated_at', '?')} — {len(snap.get('businesses', []))} businesses, "
          f"{added} added to the known list (total {len(known)}). {len(types)} business types → {folder}/business_types.txt")


if __name__ == "__main__":
    main()
