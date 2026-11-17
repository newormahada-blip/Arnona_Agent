// Copy of src/lib/businessKey.ts (the relay is deployed on its own, so it
// can't import from the site). Keep in sync with it and with
// scripts/arnona_common.py — all of them must build the same key.

const STREET_PREFIXES = ["שכ ", "שכונת ", "דרך ", "רחוב ", "שדרות ", "שד ", "הרבנית ", "הרב ", "האדמור ", "רבי ", "ר "];
const ADDR_PREFIXES = ["רחוב ", "רח' ", "שדרות ", "שד' ", "שד ", "סמטת ", "כיכר ", "גן ", "מעלה ", "מורד "];
const CITY = /(^|[\s,])(ירושלים|jerusalem)\s*$/i;
const NAME_NOISE = new Set(["בעמ", "בע", "מ", "דר", "עוד", "עו", "פרופ", "פרופסור", "רוח", "מר", "גב", "הרב", "ltd", "inc", "dr"]);

function streetKey(street) {
  let s = street.replace(/["'`׳״’]/g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\s+סמ\s*\d+$/, "").trim();
  for (const p of STREET_PREFIXES) if (s.startsWith(p)) s = s.slice(p.length);
  return s.split(" ").filter(Boolean).sort().join(" ");
}

function cleanAddress(address) {
  if (!address) return "";
  let base = address.split(",")[0].trim();
  for (const p of ADDR_PREFIXES) if (base.startsWith(p)) { base = base.slice(p.length); break; }
  base = base.replace(/\s+/g, " ").trim();
  return base.replace(/\s+(דירה|דיר|דר|יח'|יחידה|קומה)\s+\d+.*/i, "").trim();
}

function parseAddress(clean) {
  const m = clean.match(/^(.*?\D)\s*(\d+)(?:\s*[א-ת]|\s*\/\s*[\dא-ת]+)?(?:\s+.*)?$/);
  if (!m) return { street: clean.trim(), number: null };
  return { street: m[1].trim(), number: m[2] === "0" ? null : m[2] };
}

export function tidyAddress(address) {
  let a = (address ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2 && CITY.test(a); i++) a = a.replace(CITY, "").replace(/[\s,]+$/, "").trim();
  return a;
}

export function addressKey(address) {
  const { street, number } = parseAddress(cleanAddress(tidyAddress(address)));
  return `${streetKey(street)}|${number ?? ""}`;
}

function nameWords(name) {
  const s = (name ?? "").toLowerCase()
    .replace(/["'`׳״’]/g, "")
    .replace(/(?<=\p{L})\.(?=\p{L})/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ");
  return s.split(" ").filter(w => w && !NAME_NOISE.has(w));
}

export function businessKey(name, address) {
  return `${[...new Set(nameWords(name))].sort().join(" ")}#${addressKey(address)}`;
}

export function looksLikeSameBusiness(a, b) {
  const ka = addressKey(a.address);
  if (ka.endsWith("|")) return false;
  if (ka !== addressKey(b.address)) return false;
  const wa = new Set(nameWords(a.name).filter(w => w.length > 1));
  const wb = new Set(nameWords(b.name).filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return false;
  const shared = [...wa].filter(w => wb.has(w)).length;
  if (shared >= 2) return true;
  if (shared === 1 && Math.min(wa.size, wb.size) === 1) return true;
  const ja = [...wa].join(" "), jb = [...wb].join(" ");
  return ja.length >= 4 && jb.length >= 4 && (ja.includes(jb) || jb.includes(ja));
}
