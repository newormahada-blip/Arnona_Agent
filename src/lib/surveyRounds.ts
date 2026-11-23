import { supabase } from './supabase'
import type { Business, SurveyRound } from './types'

// Field-trip rounds (סבבי יציאה לשטח), table survey_rounds. Every send to the
// surveyor is tagged with a round number (businesses.survey_round) so each
// trip's results can be tracked on their own.

export const NO_ROUND = 'ללא סבב'

export const roundLabel = (n: number | null | undefined): string => (n ? `סבב ${n}` : NO_ROUND)

/** Filter/group value for a property: its round number as text, or NO_ROUND. */
export const roundKey = (b: Business): string => (b.surveyRound ? String(b.surveyRound) : NO_ROUND)

/** "YYYY-MM-DD" → "D.M.YYYY". */
export function formatRoundDate(sentAt: string): string {
  const m = sentAt.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${parseInt(m[3])}.${parseInt(m[2])}.${m[1]}` : sentAt
}

/** All rounds, newest (highest number) first. Empty on failure. */
export async function fetchRounds(): Promise<SurveyRound[]> {
  const { data, error } = await supabase.from('survey_rounds').select('number, sent_at, note').order('number', { ascending: false })
  if (error || !data) return []
  return data.map(r => ({ number: r.number, sentAt: r.sent_at ?? '', note: r.note ?? '' }))
}

/** The number a new round would get: one above the highest known round. */
export function nextRoundNumber(rounds: SurveyRound[], businesses: Business[] = []): number {
  const max = Math.max(0, ...rounds.map(r => r.number), ...businesses.map(b => b.surveyRound ?? 0))
  return max + 1
}

/** Local "today" as YYYY-MM-DD (the database default would use UTC). */
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Makes sure the round exists. A new round is stored with today's date; an
 * existing one keeps its date, and its note is only replaced when a new one is
 * given. Returns the round, or an error message.
 */
export async function ensureRound(number: number, note = ''): Promise<{ round: SurveyRound } | { error: string }> {
  const { data: existing, error: readError } = await supabase.from('survey_rounds').select('number, sent_at, note').eq('number', number).maybeSingle()
  if (readError) return { error: readError.message }
  if (existing) {
    const trimmed = note.trim()
    if (trimmed && trimmed !== existing.note) {
      const { error } = await supabase.from('survey_rounds').update({ note: trimmed }).eq('number', number)
      if (error) return { error: error.message }
    }
    return { round: { number, sentAt: existing.sent_at, note: trimmed || existing.note } }
  }
  const row = { number, sent_at: today(), note: note.trim() }
  const { error } = await supabase.from('survey_rounds').insert(row)
  if (error) return { error: error.message }
  return { round: { number, sentAt: row.sent_at, note: row.note } }
}
