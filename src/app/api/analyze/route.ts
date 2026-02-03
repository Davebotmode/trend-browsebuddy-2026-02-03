import { NextResponse } from 'next/server';

import nlp from 'compromise';
import natural from 'natural';
import { removeStopwords } from 'stopword';

export const runtime = 'nodejs';

type LlmPlan = {
  summary: string;
  key_points: string[];
  risks: string[];
  next_actions: string[];
  questions_to_answer: string[];
};

type Mode = 'deterministic' | 'llm';

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
  const sample = text.slice(0, 40_000);
  const doc = nlp(sample);

  const people = doc.people().out('array') as string[];
  const orgs = doc.organizations().out('array') as string[];
  const places = doc.places().out('array') as string[];

  const counts = new Map<string, { type: string; text: string; count: number }>();
  function add(type: string, items: string[]) {
    for (const raw of items) {
      const t = raw.trim();
      if (!t) continue;
      const key = `${type}:${t.toLowerCase()}`;
      const prev = counts.get(key);
      counts.set(key, prev ? { ...prev, count: prev.count + 1 } : { type, text: t, count: 1 });
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

  items.push('Write a 1-sentence summary in your own words.');
  items.push('List 2 things you could build that reuse the core idea.');

  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
}

function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}

function isValidLlmPlan(x: unknown): x is LlmPlan {
  const isStr = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  const isStrArr = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string');
  const o = x as Record<string, unknown> | null;
  return (
    o &&
    isStr(o.summary) &&
    isStrArr(o.key_points) &&
    isStrArr(o.risks) &&
    isStrArr(o.next_actions) &&
    isStrArr(o.questions_to_answer)
  );
}

async function runOpenAIPlan(input: {
  title?: string | null;
  url?: string | null;
  textContent: string;
  topKeywords: { term: string; score: number }[];
  entities: { type: string; text: string; count: number }[];
}): Promise<LlmPlan> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const prompt = [
    'You are BrowseBuddy, a page-aware assistant.',
    'Given extracted page content, produce a concise summary and an action plan.',
    '',
    'Return ONLY valid JSON matching:',
    '{ summary: string; key_points: string[]; risks: string[]; next_actions: string[]; questions_to_answer: string[] }',
    '',
    'Guidelines:',
    '- summary <= 6 sentences',
    '- key_points 5-10 bullets',
    '- risks 0-6 bullets',
    '- next_actions 5-10 bullets, pragmatic and sequenced',
    '- questions_to_answer 3-8 bullets',
  ].join('\n');

  const payload = {
    model: 'gpt-4.1-mini',
    input: [
      { role: 'system', content: [{ type: 'text', text: prompt }] },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                url: input.url,
                title: input.title,
                topKeywords: input.topKeywords,
                entities: input.entities,
                textContent: clampString(input.textContent, 40_000),
              },
              null,
              2
            ),
          },
        ],
      },
    ],
    text: { format: { type: 'json_object' } },
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI error: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 500)}` : ''}`);
  }

  const json = await res.json();
  const text = (json?.output_text as string) || '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}$/);
    if (!m) throw new Error('Could not parse JSON from OpenAI response');
    parsed = JSON.parse(m[0]);
  }

  if (!isValidLlmPlan(parsed)) throw new Error('OpenAI returned invalid JSON contract');
  return parsed;
}

export async function POST(req: Request) {
  const mode = ((new URL(req.url)).searchParams.get('mode') || 'deterministic') as Mode;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const b = body as Record<string, unknown> | null;
  const title = typeof b?.title === 'string' ? b.title : undefined;
  const url = typeof b?.url === 'string' ? b.url : undefined;
  const textContent = typeof b?.textContent === 'string' ? b.textContent : '';

  if (!textContent.trim()) {
    return NextResponse.json({ ok: false, error: 'Missing textContent' }, { status: 400 });
  }

  const cleanedText = textContent.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const wordCount = cleanedText ? cleanedText.split(/\s+/).length : 0;
  const readingMinutes = Math.max(1, Math.round(wordCount / 220));

  const topKeywords = computeKeywords(cleanedText);
  const entities = computeEntities(cleanedText);
  const actionChecklist = computeChecklist(cleanedText, title);

  const base = {
    ok: true as const,
    url,
    title,
    textContent: cleanedText,
    wordCount,
    readingMinutes,
    topKeywords,
    entities,
    actionChecklist,
  };

  if (mode !== 'llm') return NextResponse.json(base);

  if (!hasOpenAIKey()) {
    return NextResponse.json({
      ...base,
      warning: 'LLM mode requested but OPENAI_API_KEY is not set; using deterministic output.',
    });
  }

  try {
    const llm = await runOpenAIPlan({ title, url, textContent: cleanedText, topKeywords, entities });
    return NextResponse.json({ ...base, llm, mode: 'llm' as const });
  } catch (e: unknown) {
    const err = e as { message?: string } | null;
    return NextResponse.json({
      ...base,
      warning: `LLM mode failed; using deterministic output. ${err?.message ?? ''}`.trim(),
    });
  }
}
