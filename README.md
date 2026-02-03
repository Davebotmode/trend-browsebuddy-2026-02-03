# BrowseBuddy (Trend App)

Trend-inspired mini app built for Tony’s daily AI trend app builder.

## Trend

The trend: **“page-aware” AI browser assistants / browser agents**.

Links:
- HN: **Show HN: Browse Bot, a page-aware AI browser assistant** — https://news.ycombinator.com/item?id=46868592
- Repo: https://github.com/Protos-Galaxias/Browse-Bot

## What this app does

Paste any article URL and BrowseBuddy will:
- Fetch the page server-side
- Extract the “main content” (Readability)
- Compute **top keywords** (TF‑IDF)
- Extract **rough entities** (people / orgs / places)
- Generate a **next-action checklist** (heuristics — no LLM)

No API keys required.

## Local dev

```bash
npm install
npm run dev
```

Then open http://localhost:3000

## Notes / limitations

- Some sites block server-side fetching or require JS to render content.
- The “assistant” bits are deliberately deterministic so the app is deployable without secrets.

## Next improvement

Add optional LLM mode:
- If `OPENAI_API_KEY` (or similar) is present, generate a real summary + action plan.
- Otherwise, fall back to the current deterministic pipeline.
