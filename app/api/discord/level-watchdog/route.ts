import { NextRequest, NextResponse } from 'next/server';
import { findChitchatGuildId } from '@/lib/discord';
import { getGuildChannels, modifyChannel } from '@/lib/discord';
import { LEVEL_DATA_CHANNEL_NAME } from '@/lib/level-system';

export const runtime = 'nodejs';

function normalize(value: unknown) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function authorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;
  return request.headers.get('authorization') === 'Bearer ' + cronSecret;
}

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const setupSecret = process.env.DISCORD_SETUP_SECRET?.trim();
    if (!setupSecret) {
      throw new Error('DISCORD_SETUP_SECRET is not configured in Vercel.');
    }

    const guildId = await findChitchatGuildId();
    const channels = await getGuildChannels(guildId);
    const dataChannel = channels.find(
      (channel) => normalize(channel.name) === normalize(LEVEL_DATA_CHANNEL_NAME),
    );

    if (!dataChannel) {
      throw new Error('Level data channel was not found.');
    }

    // Replacing the lease safely stops an old worker on its next poll,
    // while the new worker starts from the existing persisted XP store.
    const leaseToken = crypto.randomUUID();
    await modifyChannel(dataChannel.id, {
      topic: 'CHITCHAT_LEVEL_WORKER:' + leaseToken,
    });

    const baseUrl = request.nextUrl.origin;
    const response = await fetch(baseUrl + '/api/discord/level-worker', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + setupSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        initialize: true,
        guildId,
        baseUrl,
        leaseToken,
      }),
      cache: 'no-store',
    });

    const body = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error('Level worker restart failed: HTTP ' + response.status + ' ' + body.slice(0, 300));
    }

    return NextResponse.json({
      ok: true,
      restarted: true,
      message: 'Level worker watchdog started a fresh worker.',
    });
  } catch (error) {
    console.error('[level-watchdog] failed:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error.',
    }, { status: 500 });
  }
}
