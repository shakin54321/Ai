import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';
import { findChitchatGuildId } from '@/lib/discord';
import { getGuildChannels, modifyChannel } from '@/lib/discord';
import { LEVEL_DATA_CHANNEL_NAME } from '@/lib/level-system';

export const runtime = 'nodejs';
export const maxDuration = 130;

function page(message = '', error = false) {
  const safe = message
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const html =
    '<!doctype html><html lang="en"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>CHITCHAT Level Worker</title>' +
    '<style>' +
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at top,#2b183d 0,#09090d 45%,#050507 100%);color:#fff}' +
    '.card{width:min(100%,430px);padding:28px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:rgba(255,255,255,.07);backdrop-filter:blur(18px);box-shadow:0 20px 70px rgba(0,0,0,.45)}' +
    'h1{margin:0 0 8px;font-size:28px}p{color:rgba(255,255,255,.7);line-height:1.5}' +
    'input{width:100%;padding:14px 15px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.24);color:#fff;outline:none}' +
    'button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:14px;background:#fff;color:#111;font-weight:700;cursor:pointer}' +
    '.msg{margin-top:14px;padding:12px 14px;border-radius:12px;background:' +
    (error ? 'rgba(255,85,85,.14)' : 'rgba(85,255,150,.12)') +
    ';color:' + (error ? '#ffb2b2' : '#b9ffd2') +
    ';white-space:pre-wrap}.hint{font-size:13px;margin-top:12px}' +
    '</style></head><body><main class="card">' +
    '<h1>CHITCHAT Level Worker</h1>' +
    '<p>Starts the XP and live leaderboard worker without Vercel Workflow.</p>' +
    '<form method="post"><input name="key" type="password" placeholder="Setup secret" required><button type="submit">Start Level Worker</button></form>' +
    (safe ? '<div class="msg">' + safe + '</div>' : '') +
    '<p class="hint">Use the same private Discord setup secret.</p>' +
    '</main></body></html>';

  return new NextResponse(html, {
    status: error ? 401 : 200,
    headers: {'Content-Type': 'text/html; charset=utf-8'},
  });
}

function checkSecret(value: string | null) {
  const configured = process.env.DISCORD_SETUP_SECRET?.trim();

  if (!configured) {
    throw new Error('DISCORD_SETUP_SECRET is not configured in Vercel.');
  }

  if (value !== configured) {
    throw new Error('Invalid setup key.');
  }
}

export async function GET() {
  return page();
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const supplied =
      typeof form.get('key') === 'string' ? String(form.get('key')) : null;

    checkSecret(supplied);

    const guildId = await findChitchatGuildId();
    const channels = await getGuildChannels(guildId);
    const dataChannel = channels.find(
      (channel) =>
        (channel.name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') ===
        LEVEL_DATA_CHANNEL_NAME.toUpperCase().replace(/[^A-Z0-9]/g, ''),
    );

    if (!dataChannel) {
      throw new Error(
        'The level-data channel was not found. Run the normal Discord setup once after the level channels exist.',
      );
    }

    const leaseToken = crypto.randomUUID();
    await modifyChannel(dataChannel.id, {
      topic: 'CHITCHAT_LEVEL_WORKER:' + leaseToken,
    });

    const baseUrl = request.nextUrl.origin;

    after(async () => {
      try {
        const response = await fetch(
          baseUrl + '/api/discord/level-worker',
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + (process.env.DISCORD_SETUP_SECRET?.trim() ?? ''),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              initialize: true,
              guildId,
              baseUrl,
              leaseToken,
            }),
            cache: 'no-store',
          },
        );

        if (!response.ok) {
          console.error(
            '[level-worker] initial launch failed:',
            response.status,
            await response.text().catch(() => ''),
          );
        }
      } catch (error) {
        console.error('[level-worker] initial launch error:', error);
      }
    });

    return page(
      'Level Worker is ACTIVE.\n\n' +
        'Every 5 valid messages = 10 XP.\n' +
        'Leaderboard updates automatically about every 30 seconds.\n' +
        'Vercel Workflow level daemon: NOT USED.\n\n' +
        'No changes were made to verification, AI, member count, welcome, or announcement systems.',
      false,
    );
  } catch (error) {
    return page(
      error instanceof Error ? error.message : 'Unknown setup error.',
      true,
    );
  }
}
