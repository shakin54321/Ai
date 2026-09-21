import { NextRequest, NextResponse } from 'next/server';
import {
  CHITCHAT_AI_LEASE_PREFIX,
  ensureChitchatAiChatChannel,
  findChitchatGuildId,
  getBotUserId,
  getChitchatAiChatChannel,
  getDiscordChannelMessages,
  modifyChannel,
  sendDiscordChannelMessage,
} from '@/lib/discord';

export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;
  return request.headers.get('authorization') === 'Bearer ' + cronSecret;
}

type WatchdogMessage = { id: string; author?: { id?: string; bot?: boolean } };

function sortNewestFirst(messages: WatchdogMessage[]) {
  return [...messages].sort((a, b) => {
    try {
      return Number(BigInt(b.id) - BigInt(a.id));
    } catch {
      return b.id.localeCompare(a.id);
    }
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ok: false}, {status: 401});
    }

    const setupSecret = process.env.DISCORD_SETUP_SECRET?.trim();
    if (!setupSecret) {
      throw new Error('DISCORD_SETUP_SECRET is not configured in Vercel.');
    }

    const guildId = await findChitchatGuildId();
    let channel = await getChitchatAiChatChannel(guildId);
    const leaseToken = crypto.randomUUID();

    if (!channel) {
      channel = await ensureChitchatAiChatChannel(guildId, leaseToken);
    } else {
      await modifyChannel(channel.id, {
        topic: CHITCHAT_AI_LEASE_PREFIX + leaseToken,
      });
    }

    if (!channel) {
      throw new Error('The ai-chat channel could not be found or prepared.');
    }

    const botUserId = await getBotUserId();
    const messages = (await getDiscordChannelMessages(channel.id, {
      limit: 100,
    })) as Array<{
      id: string;
      author?: {id?: string; bot?: boolean};
    }>;

    const latestBotMessage = sortNewestFirst(messages).find(
      (message) => message.author?.id === botUserId,
    );

    let cursor = latestBotMessage?.id ?? '';

    if (!cursor) {
      const marker = await sendDiscordChannelMessage(channel.id, {
        content: 'CHITCHAT AI is online. Send a message here to start chatting.',
        allowed_mentions: {parse: []},
      });
      cursor = marker.id;
    }

    const baseUrl = request.nextUrl.origin;
    const response = await fetch(baseUrl + '/api/discord/ai-worker', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + setupSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channelId: channel.id,
        leaseToken,
        cursor,
        baseUrl,
      }),
      cache: 'no-store',
    });

    const body = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(
        'AI worker restart failed: HTTP ' +
          response.status +
          ' ' +
          body.slice(0, 300),
      );
    }

    return NextResponse.json({
      ok: true,
      restarted: true,
      channelId: channel.id,
      cursor,
    });
  } catch (error) {
    console.error('[ai-watchdog] failed:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error.',
      },
      {status: 500},
    );
  }
}
