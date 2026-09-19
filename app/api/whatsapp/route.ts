import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAKE_WEBHOOK_URL =
  'https://hook.eu1.make.com/6tn2oyw83jb3xk3n75usdo9s9cxmor2p';

// This token is only used by Meta to verify that this webhook belongs to us.
// It is not an API credential.
const VERIFY_TOKEN = 'ShakinWhatsAppVerify_2026';

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
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  try {
    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('make_bridge_failed', response.status);
      return NextResponse.json(
        { ok: false, error: 'make_webhook_failed' },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, forwarded: true }, { status: 200 });
  } catch (error) {
    console.error('make_bridge_error', error);
    return NextResponse.json({ ok: false, error: 'bridge_error' }, { status: 502 });
  }
}
