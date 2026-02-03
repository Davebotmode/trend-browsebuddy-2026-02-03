import { NextResponse } from 'next/server';

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import nlp from 'compromise';
import natural from 'natural';
import { removeStopwords } from 'stopword';

export const runtime = 'nodejs';

function clampString(s: string, max = 120_000) {
  return s.length > max ? s.slice(0, max) : s;
}

function computeKeywords(text: string) {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = cleaned.split(' ').filter(Boolean);
  const filtered = removeStopwords(tokens).filter((t) => t.length >= 3 && t.length <= 24);

  const tfidf = new natural.TfIdf();
  tfidf.addDocument(filtered);

  const terms = tfidf.listTerms(0).slice(0, 18);
  return terms.map((t) => ({ term: t.term, score: t.tfidf }));
}

function computeEntities(text: string) {
  // compromise does best on smaller chunks; keep it snappy
  const sample = text.slice(0, 40_000);
  const doc = nlp(sample);

  const people = doc.people().out('array') as string[];
  const orgs = doc.organizations().out('array') as string[];
  const places = doc.places().out('array') as string[];

  const counts = new Map<string, { type: string; text: string; count: number }>();
  function add(type: string, items: string[]) {
    for (const raw of items) {
      const text = raw.trim();
      if (!text) continue;
      const key = `${type}:${text.toLowerCase()}`;
      const prev = counts.get(key);
      counts.set(key, prev ? { ...prev, count: prev.count + 1 } : { type, text, count: 1 });
    }
  }

  add('person', people);
  add('org', orgs);
  add('place', places);

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

function computeChecklist(text: string, title?: string) {
  const hay = `${title ?? ''}\n\n${text}`.toLowerCase();

  const items: string[] = [];

  if (/(github\.com|repo|repository|pull request|pr\b)/.test(hay)) {
    items.push('Open the repo and skim the README + open issues.');
    items.push('Check the last 5 commits to understand current direction.');
  }

  if (/(install|npm i|pip install|brew install|setup|getting started)/.test(hay)) {
    items.push('Find the setup/installation section and run it in a clean folder.');
  }

  if (/(api|endpoint|rate limit|auth|token)/.test(hay)) {
    items.push('Identify required auth + rate limits; write down what’s needed to run it locally.');
  }

  if (/(benchmark|eval|evaluation|accuracy|hallucinat)/.test(hay)) {
    items.push('Locate the evaluation methodology and note what was measured (and what wasn’t).');
  }

  if (/(pricing|cost|latency|speed)/.test(hay)) {
    items.push('Capture cost/latency claims and look for caveats or missing assumptions.');
  }

  // Always give something useful even for random pages
  items.push('Write a 1-sentence summary in your own words.');
  items.push('List 2 things you could build that reuse the core idea.');

  // De-dupe while preserving order
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get('url')?.trim();

  if (!rawUrl) {
    return NextResponse.json({ ok: false, error: 'Missing ?url=' }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid URL' }, { status: 400 });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return NextResponse.json({ ok: false, error: 'Only http(s) URLs are supported' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'user-agent':
          'BrowseBuddy/1.0 (+https://github.com/Davebotmode) Mozilla/5.0 (compatible; ExtractorBot)',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Fetch failed: ${res.status} ${res.statusText}` },
        { status: 502 }
      );
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return NextResponse.json(
        { ok: false, error: `Unsupported content-type: ${contentType || 'unknown'}` },
        { status: 415 }
      );
    }

    const html = clampString(await res.text(), 1_200_000);

    const dom = new JSDOM(html, { url: url.toString() });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return NextResponse.json(
        { ok: false, error: 'Could not extract main article content (Readability returned null).' },
        { status: 422 }
      );
    }

    const textContent = (article.textContent || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const wordCount = article.length ?? (textContent ? textContent.split(/\s+/).length : undefined);
    const readingMinutes = typeof wordCount === 'number' ? Math.max(1, Math.round(wordCount / 220)) : undefined;

    const topKeywords = textContent ? computeKeywords(textContent) : [];
    const entities = textContent ? computeEntities(textContent) : [];
    const actionChecklist = computeChecklist(textContent, article.title ?? undefined);

    return NextResponse.json({
      ok: true,
      url: url.toString(),
      title: article.title,
      byline: article.byline,
      siteName: article.siteName,
      excerpt: article.excerpt,
      textContent,
      wordCount,
      readingMinutes,
      topKeywords,
      entities,
      actionChecklist,
    });
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Fetch timed out (12s).' : e?.message ?? 'Unknown error.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
