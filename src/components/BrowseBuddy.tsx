'use client';

import { useEffect, useMemo, useState } from 'react';

type Capabilities = {
  hasOpenAIKey: boolean;
};

type LlmPlan = {
  summary: string;
  key_points: string[];
  risks: string[];
  next_actions: string[];
  questions_to_answer: string[];
};

type ExtractResult = {
  ok: boolean;
  error?: string;
  warning?: string;
  mode?: 'deterministic' | 'llm';
  llm?: LlmPlan;
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
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [llmMode, setLlmMode] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/capabilities');
        const json = (await res.json()) as Capabilities;
        if (mounted) setCaps(json);
      } catch {
        if (mounted) setCaps({ hasOpenAIKey: false });
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
      const mode = llmMode ? 'llm' : 'deterministic';
      const res = await fetch(
        `/api/extract?url=${encodeURIComponent(url.trim())}&mode=${encodeURIComponent(mode)}`
      );
      const json = (await res.json()) as ExtractResult;
      setData(json);
    } catch (e: unknown) {
      const err = e as { message?: string } | null;
      setData({ ok: false, error: err?.message ?? 'Unknown error' });
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
            A &quot;page-aware&quot; browser assistant — without API keys. Paste a URL, and it will extract the
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

        <div className="row" style={{ marginTop: 10, justifyContent: 'flex-start', gap: 10 }}>
          <label className="fine" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={llmMode}
              disabled={!caps?.hasOpenAIKey}
              onChange={(e) => setLlmMode(e.target.checked)}
            />
            LLM mode (uses server key)
          </label>
          {!caps ? <span className="fine muted">Checking capabilities…</span> : null}
          {caps && !caps.hasOpenAIKey ? (
            <span className="fine muted">(OPENAI_API_KEY not set on server)</span>
          ) : null}
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

      {data && data.ok && data.warning ? (
        <section className="card" style={{ borderColor: 'rgba(255, 204, 102, 0.45)' }}>
          <h2 style={{ marginTop: 0 }}>Note</h2>
          <p className="mono">{data.warning}</p>
        </section>
      ) : null}

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

            {llmMode ? (
              <section className="card">
                <h3>LLM summary + plan</h3>
                {data.llm ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <div className="kicker">Summary</div>
                      <p style={{ marginTop: 6 }}>{data.llm.summary}</p>
                    </div>

                    <div>
                      <div className="kicker">Key points</div>
                      <ul className="list">
                        {data.llm.key_points.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>

                    {(data.llm.risks ?? []).length ? (
                      <div>
                        <div className="kicker">Risks / caveats</div>
                        <ul className="list">
                          {data.llm.risks.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div>
                      <div className="kicker">Next actions</div>
                      <ol className="list">
                        {data.llm.next_actions.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ol>
                    </div>

                    <div>
                      <div className="kicker">Questions to answer</div>
                      <ul className="list">
                        {data.llm.questions_to_answer.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <p className="muted">No LLM output (using deterministic output).</p>
                )}
              </section>
            ) : null}
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
