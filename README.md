# amtrak-explorer

Browse Amtrak stations and routes, and ask plain-English questions about schedules
("first train from New York to Boston next Thursday?", "Friday out, Sunday back from
Philadelphia"). Built on real Amtrak GTFS data. A learning project: SQL, analytics
instrumentation and AI-product evals.

**Live:** https://amtrak-explorer.vercel.app (behind Vercel SSO, so you need to be signed in)

## Stack

| Layer | What |
|---|---|
| Database | Neon (serverless Postgres) |
| Frontend | Plain HTML/JS/CSS, no framework, no build step |
| Backend | Vercel serverless functions (`api/`); all database access goes through them |
| AI | Anthropic API, one pinned model, three fixed-SQL tools (the model never writes SQL) |
| Hosting | Vercel, auto-deploys on push to `main` |

## Run it locally

```bash
npm install
npm test        # unit tests, free, no network
```

The `api/` functions need real credentials, so test them on the deployed site or with
`vercel dev`. `npx serve` only serves the static page.

## Run the evals

The eval harness runs 40 hand-written questions through the real ask loop and appends a
row to `eval/RESULTS.md`. It makes real model calls (a few tens of cents), so run it on
demand, never in CI.

```bash
vercel env pull .env.local    # DATABASE_URL + ANTHROPIC_API_KEY (git-ignored)
npm run eval                  # add -- --no-record to skip writing a row
```

- If keys are missing, try `npx vercel env pull .env.local --environment=production`.
- A Sensitive variable pulls as an empty value or placeholder: paste your own key into
  `.env.local`.

## Where to read more

- [`CLAUDE.md`](CLAUDE.md): how the project works, the architecture rules, the AI layer,
  data gotchas, roadmap and open items. Start here.
- [`docs/PRD.md`](docs/PRD.md): what this phase set out to build and why.
- [`eval/RESULTS.md`](eval/RESULTS.md): the eval run log.
