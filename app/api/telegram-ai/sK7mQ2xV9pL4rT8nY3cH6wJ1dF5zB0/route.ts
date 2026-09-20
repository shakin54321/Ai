import { generateText } from 'ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BRIDGE_KEY = 'sK7mQ2xV9pL4rT8nY3cH6wJ1dF5zB0';

export async function POST(request: Request) {
  const url = new URL(request.url);

  if (!url.pathname.endsWith('/telegram-ai/' + BRIDGE_KEY)) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const input = body as {
    text?: unknown;
    userId?: unknown;
    context?: unknown;
  };

  const text = typeof input.text === 'string' ? input.text.trim() : '';

  if (!text) {
    return Response.json({ ok: false, error: 'missing_text' }, { status: 400 });
  }

  if (text.length > 12000) {
    return Response.json({ ok: false, error: 'text_too_long' }, { status: 413 });
  }

  const context =
    typeof input.context === 'string' ? input.context.trim().slice(-12000) : '';

  const userId =
    typeof input.userId === 'string' && input.userId.trim()
      ? input.userId.trim()
      : 'telegram-channel';

  const prompt = [
    "You are Shakin's official Telegram AI Assistant.",
    "Answer the user directly and helpfully.",
    "Be intelligent, accurate, concise, natural, and clean.",
    "Match the user's language: Bangla, Banglish, or English.",
    "Do not mention Make, Vercel, webhooks, automations, APIs, or internal systems.",
    "Do not claim you performed actions you did not perform.",
    "For current information you cannot verify, say so clearly instead of inventing facts.",
    "Avoid unnecessary emojis and avoid filler.",
    context ? "Recent conversation context:\n" + context : "",
    "User message:\n" + text,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await generateText({
      model: 'openai/gpt-5.4',
      prompt,
      providerOptions: {
        gateway: {
          user: userId,
          tags: ['feature:telegram-bot'],
        },
      },
    });

    const reply = result.text.trim();

    if (!reply) {
      return Response.json(
        { ok: false, error: 'empty_ai_reply' },
        { status: 502 },
      );
    }

    return Response.json(
      {
        ok: true,
        reply,
        model: result.response?.modelId ?? 'openai/gpt-5.4',
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('telegram_ai_error', error);
    return Response.json(
      { ok: false, error: 'ai_generation_failed' },
      { status: 500 },
    );
  }
}
