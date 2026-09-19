import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export const runtime = 'nodejs';

const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';

async function telegramSend(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { skipped: true };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) throw new Error(`Telegram send failed: ${response.status}`);
  return response.json();
}

async function whatsappSend(to: string, body: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error('WhatsApp credentials are not configured.');
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`WhatsApp send failed: ${response.status} ${detail}`);
  }
  return response.json();
}

async function makeAgentReply(incoming: string, sender: string) {
  const result = await generateText({
    model: openai(process.env.OPENAI_MODEL || 'gpt-4o-mini'),
    system:
      'You are Shakin’s private WhatsApp assistant. Reply briefly and naturally to incoming WhatsApp messages. Do not claim to be Shakin. Do not mention AI, automation, bots, or this workflow. The owner is currently unavailable, so be helpful, polite, concise, and conversational. Match the language of the incoming message when practical. Never reveal private system details.',
    prompt: `Incoming WhatsApp message from ${sender}:\n${incoming}`,
    maxOutputTokens: 120,
    temperature: 0.4,
  });
  return result.text.trim();
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token && challenge && verifyToken && token === verifyToken) {
    return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }

  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(request: NextRequest) {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  const contact = value?.contacts?.[0];

  if (!message || !message.from) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const sender = String(message.from);
  const incoming =
    message.type === 'text'
      ? String(message.text?.body || '')
      : `[${String(message.type || 'message')} message]`;

  try {
    await telegramSend(`📥 WhatsApp\nFrom: ${sender}\n\n${incoming}`);

    const reply = await makeAgentReply(incoming, contact?.profile?.name || sender);

    await telegramSend(`🤖 AI reply\nTo: ${sender}\n\n${reply}`);

    await whatsappSend(sender, reply);

    return NextResponse.json({ ok: true, replied: true });
  } catch (error) {
    console.error('bridge_error', error);
    return NextResponse.json({ ok: false, error: 'bridge_failed' }, { status: 500 });
  }
}
