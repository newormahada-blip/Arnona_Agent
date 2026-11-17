import { cleanAddress, parseAddress } from './geocode'

// When are two businesses the same one? The raw "name|address" string is not
// enough: the agent writes "התיבונים 7, ירושלים" one day and "התיבונים 7" the
// next, "ד"ר" with ״ or with ", with or without "בע"מ". Every upload path
// (this site, the GitHub workflow, the relay, the Python scripts and the
// database trigger business_dedup_key()) compares businesses by the same key,
// built the same way — keep them in sync:
//   scripts/arnona_common.py · vercel-relay/api/upload.js ·
//   supabase/migrations/20261117_business_dedup_key.sql

const STREET_PREFIXES = ['שכ ', 'שכונת ', 'דרך ', 'רחוב ', 'שדרות ', 'שד ', 'הרבנית ', 'הרב ', 'האדמור ', 'רבי ', 'ר ']

// Same key as street_key() in build_street_index.py: no quotes or hyphens, no
// alley suffix ("סמ3"), no title/street-type prefix, words sorted — so
// "הרב שמעון אגסי" and "אגסי שמעון" meet.
export function streetKey(street: string): string {
  let s = street.replace(/["'`׳״’]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/\s+סמ\s*\d+$/, '').trim()
  for (const p of STREET_PREFIXES) {
    if (s.startsWith(p)) s = s.slice(p.length)
  }
  return s.split(' ').filter(Boolean).sort().join(' ')
}

const CITY = /(^|[\s,])(ירושלים|jerusalem)\s*$/i

/** The address as it should be stored: no ", ירושלים" at the end, single spaces. */
export function tidyAddress(address: string): string {
  let a = (address ?? '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 2 && CITY.test(a); i++) a = a.replace(CITY, '').replace(/[\s,]+$/, '').trim()
  return a
}

/** "התיבונים 7, ירושלים" / "רחוב התיבונים 7 דירה 3" → "התיבונים|7". */
export function addressKey(address: string): string {
  const { street, number } = parseAddress(cleanAddress(tidyAddress(address)))
  return `${streetKey(street)}|${number ?? ''}`
}

// Titles and company suffixes that the same business is written with or without.
const NAME_NOISE = new Set(['בעמ', 'בע', 'מ', 'דר', 'עוד', 'עו', 'פרופ', 'פרופסור', 'רוח', 'מר', 'גב', 'הרב', 'ltd', 'inc', 'dr'])

/** The meaningful words of a name, without quotes, punctuation and titles. */
export function nameWords(name: string): string[] {
  const s = (name ?? '').toLowerCase()
    .replace(/["'`׳״’]/g, '')
    .replace(/(?<=\p{L})\.(?=\p{L})/gu, '') // "ד.ר" = "דר", "ע.ל.י.מ" = "עלימ"
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
  return s.split(' ').filter(w => w && !NAME_NOISE.has(w))
}

/** 'מאיר ד"ר דניאל (פסיכיאטר)' → "דניאל מאיר פסיכיאטר" (sorted words). */
export function nameKey(name: string): string {
  return [...new Set(nameWords(name))].sort().join(' ')
}

export function businessKey(name: string, address: string): string {
  return `${nameKey(name)}#${addressKey(address)}`
}

/**
 * Not the same key, but very likely the same business: same street and house
 * number, and one name contains the other, or they share at least two words
 * (or their only word). Shown to the employee instead of being added silently.
 */
export function looksLikeSameBusiness(a: { name: string; address: string }, b: { name: string; address: string }): boolean {
  const ka = addressKey(a.address)
  if (ka.endsWith('|')) return false // no house number — too vague
  if (ka !== addressKey(b.address)) return false
  const wa = new Set(nameWords(a.name).filter(w => w.length > 1))
  const wb = new Set(nameWords(b.name).filter(w => w.length > 1))
  if (wa.size === 0 || wb.size === 0) return false
  const shared = [...wa].filter(w => wb.has(w)).length
  if (shared >= 2) return true
  if (shared === 1 && Math.min(wa.size, wb.size) === 1) return true
  const ja = [...wa].join(' '), jb = [...wb].join(' ')
  return ja.length >= 4 && jb.length >= 4 && (ja.includes(jb) || jb.includes(ja))
}
