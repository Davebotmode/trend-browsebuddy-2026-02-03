import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
  return NextResponse.json({ hasOpenAIKey });
}
