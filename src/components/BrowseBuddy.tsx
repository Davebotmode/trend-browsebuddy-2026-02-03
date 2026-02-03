'use client';

import { useMemo, useState } from 'react';

type ExtractResult = {
  ok: boolean;
  error?: string;
  url?: string;
  title?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  textContent?: string;
  wordCount?: number;
  readingMinutes?: number;
  topKeywords?: { term: string; score: number }[];
  entities?: { type: string; text: string; count: number }[];
  actionChecklist?: string[];
};

const EXAMPLES = [
  'https://openai.com/blog',
  'https://news.ycombinator.com/',
  'https://nextjs.org/docs',
];

export default function BrowseBuddy() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ExtractResult | null>(null);

  const canSubmit = useMemo(() => {
    if (!url.trim()) return false;
    try {
      new URL(url.trim());
      return true;
    } catch {
      return false;
    }
  }, [url]);

  async function run() {
    if (!canSubmit) return;
    setLoading(true);
    setData(null);
    try {
      const res = await fetch(`/api/extract?url=${encodeURIComponent(url.trim())}`);
      const json = (await res.json()) as ExtractResult;
      setData(json);
    } catch (e: any) {
      setData({ ok: false, error: e?.message ?? 'Unknown error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>BrowseBuddy</h1>
          <p className="sub">
            A "page-aware" browser assistant — without API keys. Paste a URL, and it will extract the
            main content, surface keywords/entities, and propose a next-action checklist.
          </p>
        </div>
      </header>

      <section className="card">
        <div className="row">
          <input
            className="input"
            placeholder="https://example.com/article"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run();
            }}
          />
          <button className="button" onClick={run} disabled={!canSubmit || loading}>
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
        <div className="examples">
          <span className="muted">Try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              className="chip"
              onClick={() => {
                setUrl(ex);
                setTimeout(run, 0);
              }}
              type="button"
            >
              {ex}
            </button>
          ))}
        </div>
        <p className="fine">
          Note: some sites block server-side fetching (anti-bot / paywalls). If extraction fails,
          try a different URL.
        </p>
      </section>

      {data && !data.ok && (
        <section className="card error">
          <h2>Error</h2>
          <p className="mono">{data.error ?? 'Unknown error'}</p>
        </section>
      )}

      {data && data.ok && (
        <section className="grid">
          <article className="card">
            <div className="meta">
              <div className="kicker">Extracted page</div>
              <a className="mono" href={data.url} target="_blank" rel="noreferrer">
                {data.url}
              </a>
            </div>

            <h2 className="title">{data.title ?? '(Untitled)'}</h2>
            <div className="muted">
              {data.siteName ? <span>{data.siteName}</span> : null}
              {data.byline ? <span> · {data.byline}</span> : null}
              {typeof data.wordCount === 'number' ? (
                <span>
                  {' '}
                  · {data.wordCount.toLocaleString()} words · ~{data.readingMinutes ?? '?'} min
                  read
                </span>
              ) : null}
            </div>

            {data.excerpt ? <p className="excerpt">{data.excerpt}</p> : null}

            {data.textContent ? (
              <details className="details" open>
                <summary>Main content (extracted)</summary>
                <pre className="content">{data.textContent.slice(0, 12000)}</pre>
                {data.textContent.length > 12000 ? (
                  <p className="fine">Truncated to 12k characters for display.</p>
                ) : null}
              </details>
            ) : null}
          </article>

          <aside className="stack">
            <section className="card">
              <h3>Top keywords</h3>
              <div className="wrap">
                {(data.topKeywords ?? []).length ? (
                  data.topKeywords!.map((k) => (
                    <span key={k.term} className="pill" title={`score ${k.score.toFixed(2)}`}>
                      {k.term}
                    </span>
                  ))
                ) : (
                  <p className="muted">No keywords found.</p>
                )}
              </div>
            </section>

            <section className="card">
              <h3>Entities (rough)</h3>
              <div className="wrap">
                {(data.entities ?? []).length ? (
                  data.entities!.map((e) => (
                    <span key={`${e.type}:${e.text}`} className="pill" title={`${e.type} × ${e.count}`}>
                      {e.text}
                      <span className="pillMeta">{e.type}</span>
                    </span>
                  ))
                ) : (
                  <p className="muted">No entities found.</p>
                )}
              </div>
            </section>

            <section className="card">
              <h3>Next-action checklist</h3>
              {(data.actionChecklist ?? []).length ? (
                <ol className="list">
                  {data.actionChecklist!.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ol>
              ) : (
                <p className="muted">No checklist generated.</p>
              )}
              <p className="fine">
                This is heuristic on purpose (no LLM). It’s meant to feel like a “page-aware assistant”
                you can extend.
              </p>
            </section>
          </aside>
        </section>
      )}

      <footer className="footer">
        <p className="fine">
          Built for Tony’s daily trend-app experiment. No tracking. No keys. Just a useful pattern.
        </p>
      </footer>
    </div>
  );
}
