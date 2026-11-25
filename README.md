# Arnona Agent

Internal web app for the Jerusalem municipality's arnona (property tax) enforcement:
businesses found online at residential addresses are tracked, sent to a field
surveyor in numbered rounds, and their survey results followed up.

- **Site:** https://newormahada-blip.github.io/Arnona_Agent/ — a static Next.js export
  (`next.config.ts`, `output: 'export'`), built and published to GitHub Pages by
  `.github/workflows/deploy.yml` on every push to `main`.
- **Data:** Supabase (`src/lib/supabase.ts`); schema changes live in `supabase/migrations/`.
- **Agent pipeline:** `.github/workflows/upload-arnona.yml` uploads new reports from
  `reports/` to Supabase (secrets `SUPABASE_URL`, `SUPABASE_KEY`) and refreshes
  `reports/agent_snapshot.json` every 3 hours.

## Development

```bash
npm install
npm run dev
```

Open http://localhost:3000/Arnona_Agent. See `AGENTS.md` before changing Next.js code.
