"""
private_data.py — files that hold municipal data live in a private Supabase
Storage bucket, not in this public repo.

Bucket `private-data`, prefix `arnona_agent/`. The repo path maps to the
object key one to one, except that Hebrew report names get ASCII names
(Supabase keys must be ASCII):
  reports/דוח נכסים חשודים DD.MM.YYYY.xlsx       -> reports/suspect_properties_DD.MM.YYYY.xlsx
  reports/עסקים חשודים מהאינטרנט DD.MM.YYYY.xlsx -> reports/suspect_web_businesses_DD.MM.YYYY.xlsx
  reports/דוח נכסים לבדיקה DD.MM.YYYY.xlsx       -> reports/review_properties_DD.MM.YYYY.xlsx
  reports/עסקים לבדיקה ...                        -> reports/review_businesses_...
arnona_agent/manifest.json lists what was moved out of git, with checksums.

Needs env SUPABASE_URL and SUPABASE_KEY (a service key: the bucket has no
policies, so only a key that bypasses RLS can read or write it).

Usage:
  python scripts/private_data.py pull <repo-path> [<repo-path> ...]
  python scripts/private_data.py push <repo-path> [<repo-path> ...]
  python scripts/private_data.py list [prefix]
"""
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

import requests

BUCKET = "private-data"
PREFIX = "arnona_agent/"
ROOT = Path(__file__).resolve().parents[1]

_RENAMES = [
    ("דוח נכסים חשודים ", "suspect_properties_"),
    ("עסקים חשודים מהאינטרנט ", "suspect_web_businesses_"),
    ("דוח נכסים לבדיקה ", "review_properties_"),
    ("עסקים לבדיקה מהאינטרנט ", "review_web_businesses_"),
    ("עסקים לבדיקה ", "review_businesses_"),
]


def object_key(repo_path: str) -> str:
    p = Path(repo_path).as_posix()
    if p.startswith("./"):
        p = p[2:]
    name = p.rsplit("/", 1)[-1]
    for heb, ascii_ in _RENAMES:
        if name.startswith(heb):
            name = ascii_ + name[len(heb):]
            break
    name = name.replace(" ", "_")
    head = p.rsplit("/", 1)[0] + "/" if "/" in p else ""
    return PREFIX + head + name


def _base_and_headers():
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    headers = {"apikey": key}
    # Under the agent proxy the key is injected into `apikey`; a dummy
    # Authorization would override it, so only send one with a real JWT/key.
    if not os.environ.get("SUPABASE_KEY_VIA_PROXY"):
        headers["Authorization"] = f"Bearer {key}"
    return f"{url}/storage/v1", headers


def pull(repo_path: str, dest: str | None = None) -> Path:
    """Download one file from the bucket to its repo path (or dest)."""
    base, headers = _base_and_headers()
    key = object_key(repo_path)
    r = requests.get(f"{base}/object/authenticated/{BUCKET}/{quote(key)}", headers=headers, timeout=120)
    if r.status_code != 200:
        raise RuntimeError(f"pull {key}: HTTP {r.status_code}")
    out = Path(dest) if dest else ROOT / repo_path
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(r.content)
    return out


def push(local_path: str, repo_path: str | None = None) -> str:
    """Upload one file to the bucket (overwrites)."""
    base, headers = _base_and_headers()
    key = object_key(repo_path or local_path)
    data = Path(local_path).read_bytes()
    r = requests.post(
        f"{base}/object/{BUCKET}/{quote(key)}",
        headers={**headers, "x-upsert": "true", "Content-Type": "application/octet-stream"},
        data=data, timeout=120,
    )
    if r.status_code not in (200, 201):
        raise RuntimeError(f"push {key}: HTTP {r.status_code}")
    return key


def ensure_local(repo_path: str) -> Path:
    """Return the local path, downloading it from the bucket if it's missing."""
    p = ROOT / repo_path if not Path(repo_path).is_absolute() else Path(repo_path)
    if not p.exists():
        rel = os.path.relpath(p, ROOT)
        print(f"{rel} is not in the repo — downloading it from the private bucket")
        pull(rel, str(p))
    return p


def list_objects(prefix: str = ""):
    base, headers = _base_and_headers()
    r = requests.post(f"{base}/object/list/{BUCKET}", headers=headers,
                      json={"prefix": PREFIX + prefix, "limit": 1000}, timeout=60)
    r.raise_for_status()
    return r.json()


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("pull", "push", "list"):
        print(__doc__)
        sys.exit(2)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "list":
        print(json.dumps([o["name"] for o in list_objects(args[0] if args else "")], ensure_ascii=False, indent=1))
    else:
        for a in args:
            print(pull(a) if cmd == "pull" else push(a))
