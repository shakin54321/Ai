import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAKE_AI_WEBHOOK_URL =
  'https://hook.eu1.make.com/x3gpkfaoio1ku2wxo3991qk8x8sdpbjg';

const VERIFY_TOKEN =
  process.env.WHATSAPP_VERIFY_TOKEN || 'ShakinWhatsAppVerify_2026';

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v26.0';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const histories = new Map<string, { messages: ChatMessage[]; updatedAt: number }>();
const seenMessages = new Map<string, number>();

function pruneMemory(now: number) {
  for (const [key, value] of histories) {
    if (now - value.updatedAt > 24 * 60 * 60 * 1000) histories.delete(key);
  }

  for (const [key, value] of seenMessages) {
    if (now - value > 60 * 60 * 1000) seenMessages.delete(key);
  }

  if (histories.size > 1000) {
    const oldest = [...histories.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
    if (oldest) histories.delete(oldest[0]);
  }

  if (seenMessages.size > 5000) {
    const oldest = [...seenMessages.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) seenMessages.delete(oldest[0]);
  }
}

function extractTextMessage(payload: any) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  if (!message || message.type !== 'text' || !message.from || !message.id) {
    return null;
  }

  const groupId =
    message.group_id ??
    message.groupId ??
    message.context?.group_id ??
    message.context?.groupId;

  if (groupId) return null;

  const phoneNumberId = value?.metadata?.phone_number_id;
  if (!phoneNumberId) return null;

  return {
    from: String(message.from),
    messageId: String(message.id),
    text: String(message.text?.body || '').trim(),
    phoneNumberId: String(phoneNumberId),
  };
}

async function getAiReply(input: {
  from: string;
  text: string;
  isFirst: boolean;
  context: string;
}) {
  const response = await fetch(MAKE_AI_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from,
      text: input.text,
      isFirst: input.isFirst,
      context: input.context,
    }),
    cache: 'no-store',
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`AI backend failed with HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('AI backend returned non-JSON data');
  }

  const reply = String(data?.reply || data?.answer || '').trim();
  if (!reply) throw new Error('AI backend returned an empty reply');

  return reply;
}

async function sendWhatsAppText(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  text: string,
) {
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
          preview_url: false,
          body: text,
        },
      }),
      cache: 'no-store',
    },
  );

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`WhatsApp send failed with HTTP ${response.status}: ${raw.slice(0, 800)}`);
  }

  return raw;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }

  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(request: NextRequest) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!accessToken) {
    console.error('whatsapp_missing_access_token');
    return NextResponse.json(
      { ok: false, error: 'missing_whatsapp_access_token' },
      { status: 500 },
    );
  }

  let payload: any;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Ignore Meta delivery/read/status notifications.
  if (!payload?.entry?.[0]?.changes?.[0]?.value?.messages) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const incoming = extractTextMessage(payload);

  if (!incoming) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const now = Date.now();
  pruneMemory(now);

  if (seenMessages.has(incoming.messageId)) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  seenMessages.set(incoming.messageId, now);

  const previous = histories.get(incoming.from)?.messages || [];
  const isFirst = previous.length === 0;

  const context = previous
    .slice(-8)
    .map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`)
    .join('\n');

  try {
    const reply = await getAiReply({
      from: incoming.from,
      text: incoming.text,
      isFirst,
      context,
    });

    await sendWhatsAppText(
      accessToken,
      incoming.phoneNumberId,
      incoming.from,
      reply,
    );

    const nextMessages: ChatMessage[] = [
      ...previous.slice(-8),
      { role: 'user', content: incoming.text },
      { role: 'assistant', content: reply },
    ];

    histories.set(incoming.from, {
      messages: nextMessages.slice(-10),
      updatedAt: now,
    });

    return NextResponse.json(
      {
        ok: true,
        replied: true,
        messageId: incoming.messageId,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('whatsapp_bridge_error', error);

    // Do not ask Meta to retry a message after we have already recorded its ID.
    // A failed run is visible in Vercel runtime logs for diagnosis.
    return NextResponse.json(
      {
        ok: false,
        error: 'bridge_failed',
      },
      { status: 200 },
    );
  }
}
