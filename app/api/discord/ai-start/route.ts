import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';
import {
  ensureChitchatAiChatChannel,
  findChitchatGuildId,
  sendDiscordChannelMessage,
} from '@/lib/discord';

export const runtime = 'nodejs';
export const maxDuration = 130;

function setupPage(message = '', isError = false) {
  const safeMessage = message
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const html = '<!doctype html>' +
    '<html lang="en">' +
    '<head>' +
    '<meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>CHITCHAT AI Worker</title>' +
    '<style>' +
    '*{box-sizing:border-box}' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at top,#2b183d 0,#09090d 45%,#050507 100%);color:#fff}' +
    '.card{width:min(100%,430px);padding:28px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:rgba(255,255,255,.07);backdrop-filter:blur(18px);box-shadow:0 20px 70px rgba(0,0,0,.45)}' +
    'h1{margin:0 0 8px;font-size:28px}' +
    'p{color:rgba(255,255,255,.7);line-height:1.5}' +
    'input{width:100%;padding:14px 15px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.24);color:#fff;outline:none}' +
    'button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:14px;background:#fff;color:#111;font-weight:700;cursor:pointer}' +
    '.msg{margin-top:14px;padding:12px 14px;border-radius:12px;background:' +
    (isError ? 'rgba(255,85,85,.14)' : 'rgba(85,255,150,.12)') +
    ';color:' + (isError ? '#ffb2b2' : '#b9ffd2') +
    ';white-space:pre-wrap}' +
    '.hint{font-size:13px;margin-top:12px}' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<main class="card">' +
    '<h1>CHITCHAT AI Worker</h1>' +
    '<p>This starts the normal-message AI in the ai-chat channel without the Vercel Workflow daemon.</p>' +
    '<form method="post">' +
    '<input name="key" type="password" autocomplete="current-password" placeholder="Setup secret" required />' +
    '<button type="submit">Start AI Worker</button>' +
    '</form>' +
    (safeMessage ? '<div class="msg">' + safeMessage + '</div>' : '') +
    '<p class="hint">Use the same private setup secret you already use for the Discord setup page.</p>' +
    '</main>' +
    '</body>' +
    '</html>';

  return new NextResponse(html, {
    status: isError ? 401 : 200,
    headers: {'Content-Type': 'text/html; charset=utf-8'},
  });
}

function validateSecret(suppliedSecret: string | null) {
  const configured = process.env.DISCORD_SETUP_SECRET?.trim();

  if (!configured) {
    throw new Error('DISCORD_SETUP_SECRET is not configured in Vercel.');
  }

  if (suppliedSecret !== configured) {
    throw new Error('Invalid setup key.');
  }
}

export async function GET() {
  return setupPage();
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const suppliedSecret =
      typeof formData.get('key') === 'string'
        ? String(formData.get('key'))
        : null;

    validateSecret(suppliedSecret);

    const guildId = await findChitchatGuildId();
    const leaseToken = crypto.randomUUID();
    const aiChannel = await ensureChitchatAiChatChannel(guildId, leaseToken);

    if (!aiChannel) {
      throw new Error('The CHITCHAT AI channel could not be prepared.');
    }

    const marker = await sendDiscordChannelMessage(aiChannel.id, {
      content: 'CHITCHAT AI is online. Send a message here to start chatting.',
      allowed_mentions: {parse: []},
    });

    const baseUrl = request.nextUrl.origin;
    const secret = process.env.DISCORD_SETUP_SECRET?.trim();

    if (!secret) {
      throw new Error('DISCORD_SETUP_SECRET is not configured in Vercel.');
    }

    after(async () => {
      try {
        const response = await fetch(baseUrl + '/api/discord/ai-worker', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + secret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channelId: aiChannel.id,
            leaseToken,
            cursor: marker.id,
            baseUrl,
          }),
          cache: 'no-store',
        });

        if (!response.ok) {
          console.error(
            '[chitchat-ai] initial worker launch failed:',
            response.status,
            await response.text().catch(() => ''),
          );
        }
      } catch (error) {
        console.error('[chitchat-ai] initial worker launch error:', error);
      }
    });

    return setupPage(
      'AI Worker is ACTIVE.\n\n' +
        'Channel: ' + (aiChannel.name ?? 'ai-chat') + '\n' +
        'Architecture: Discord REST polling → Groq → Discord\n' +
        'Vercel Workflow daemon: NOT USED\n\n' +
        'Send a normal message in ai-chat. No special command or mention is required.',
      false,
    );
  } catch (error) {
    return setupPage(
      error instanceof Error ? error.message : 'Unknown setup error.',
      true,
    );
  }
}
