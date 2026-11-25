'use client'

import { useEffect, useState } from 'react'

// Where the scanning agent is. The agent (the "Game" routine) walks the
// address list in Final_Project row by row — the list is sorted neighborhood
// by neighborhood — and after every run pushes the next row to scan. The
// address list itself is municipal data and is not public, so Final_Project
// publishes agent_progress.json: only the pointer, the total and the
// neighborhood blocks (no addresses). The site reads that straight from GitHub.
//
// What this can't tell: when a given address was scanned. Status is derived
// from the pointer only, so it's as accurate as the index the agent pushes.

const REPO = 'newormahada-blip/Final_Project'
const RAW = `https://raw.githubusercontent.com/${REPO}/main`
export const NO_NEIGHBORHOOD = 'ללא שכונה'
const CACHE_KEY = 'agent_progress_v3'
const CACHE_MS = 10 * 60 * 1000

export interface AgentBlock { name: string; start: number; count: number }

export interface AgentProgress {
  /** Next row the agent will scan (0-based); 0 after it wraps around. */
  index: number
  total: number
  /** Not published any more (the address list is private); always null. */
  nextAddress: string | null
  /** Runs of consecutive rows with the same neighborhood, in file order. */
  blocks: AgentBlock[]
}

export type NeighborhoodScan = {
  name: string
  count: number
  scanned: number
  status: 'done' | 'current' | 'pending'
  /** Position of the neighborhood's first row in the scan order. */
  order: number
}

/** Per-neighborhood scan state, in the order the agent goes through them. */
export function scanByNeighborhood(p: AgentProgress): NeighborhoodScan[] {
  const byName = new Map<string, NeighborhoodScan>()
  for (const b of p.blocks) {
    const scanned = Math.min(Math.max(p.index - b.start, 0), b.count)
    const row = byName.get(b.name) ?? { name: b.name, count: 0, scanned: 0, status: 'pending' as const, order: b.start }
    row.count += b.count
    row.scanned += scanned
    byName.set(b.name, row)
  }
  const current = p.blocks.find(b => p.index >= b.start && p.index < b.start + b.count)?.name
  return [...byName.values()]
    .map(r => ({ ...r, status: r.scanned >= r.count ? 'done' as const : r.name === current ? 'current' as const : 'pending' as const }))
    .sort((a, b) => a.order - b.order)
}

interface PublishedProgress {
  index: number
  total: number
  blocks: { neighborhood: string | null; start: number; end: number; count: number }[]
}

async function load(): Promise<AgentProgress> {
  const r = await fetch(`${RAW}/agent_progress.json`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`agent_progress.json ${r.status}`)
  const p = (await r.json()) as PublishedProgress
  const blocks: AgentBlock[] = p.blocks.map(b => ({
    name: String(b.neighborhood ?? '').trim() || NO_NEIGHBORHOOD,
    start: b.start,
    count: b.count,
  }))
  let index = Number(p.index) || 0
  if (index >= p.total) index = 0   // the agent wraps the same way

  return { index, total: p.total, nextAddress: null, blocks }
}

export function useAgentProgress(): { progress: AgentProgress | null; error: boolean } {
  const [state, setState] = useState<{ progress: AgentProgress | null; error: boolean }>({ progress: null, error: false })
  useEffect(() => {
    let cancelled = false
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null') as { at: number; progress: AgentProgress } | null
      if (cached && Date.now() - cached.at < CACHE_MS) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time cache hydration on mount
        setState({ progress: cached.progress, error: false })
        return
      }
    } catch { /* no cache */ }
    load()
      .then(progress => {
        if (cancelled) return
        setState({ progress, error: false })
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), progress })) } catch { /* ignore */ }
      })
      .catch(() => { if (!cancelled) setState({ progress: null, error: true }) })
    return () => { cancelled = true }
  }, [])
  return state
}
