import { NextRequest, NextResponse } from 'next/server';
import {
  CHITCHAT_AI_LEASE_PREFIX,
  getBotUserId,
  getDiscordChannel,
  getDiscordChannelMessages,
  sendDiscordChannelMessage,
} from '@/lib/discord';
import { generateChitchatAI, type ChitchatAIMessage } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

type DiscordMessage = {
  id: string;
  content?: string;
  author?: {
    id?: string;
    username?: string;
    global_name?: string | null;
    bot?: boolean;
  };
};

type WorkerState = {
  channelId: string;
  leaseToken: string;
  cursor: string;
  baseUrl: string;
};

const POLL_MS = 2000;
const LEASE_CHECK_MS = 8000;
const HANDLER_MS = 50000;

function sortOldestFirst(messages: DiscordMessage[]) {
  return [...messages].sort((a, b) => {
    try {
      return Number(BigInt(a.id) - BigInt(b.id));
    } catch {
      return a.id.localeCompare(b.id);
    }
  });
}

function workerSecret() {
  const value = process.env.DISCORD_SETUP_SECRET?.trim();
  if (!value) {
    throw new Error('DISCORD_SETUP_SECRET is required for the AI worker.');
  }
  return value;
}

function isAuthorized(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  return authorization === 'Bearer ' + workerSecret();
}

function isLeaseCurrent(channel: {topic?: string | null}, leaseToken: string) {
  return (channel.topic ?? '') === CHITCHAT_AI_LEASE_PREFIX + leaseToken;
}

function buildHistory(
  messages: DiscordMessage[],
  botUserId: string,
  currentMessageId: string,
): ChitchatAIMessage[] {
  return sortOldestFirst(messages)
    .filter(
      (message) =>
        message.id !== currentMessageId &&
        typeof message.content === 'string' &&
        message.content.trim(),
    )
    .slice(-10)
    .map((message) => {
      const content = message.content!.trim();

      if (message.author?.id === botUserId) {
        return {
          role: 'assistant',
          content,
        };
      }

      const displayName =
        message.author?.global_name ||
        message.author?.username ||
        'Member';

      return {
        role: 'user',
        content: displayName + ': ' + content,
      };
    });
}

async function sendReply(
  channelId: string,
  messageId: string,
  userId: string,
  responseText: string,
) {
  const chunks: string[] = [];
  for (let index = 0; index < responseText.length; index += 1900) {
    chunks.push(responseText.slice(index, index + 1900));
  }

  for (const [index, chunk] of chunks.entries()) {
    await sendDiscordChannelMessage(channelId, {
      content: index === 0 ? '<@' + userId + '> ' + chunk : chunk,
      message_reference:
        index === 0
          ? {
              message_id: messageId,
            }
          : undefined,
      allowed_mentions:
        index === 0
          ? {
              users: [userId],
            }
          : {
              parse: [],
            },
    });
  }
}

async function runWorker(state: WorkerState) {
  const botUserId = await getBotUserId();
  let cursor = state.cursor;
  let lastLeaseCheck = 0;
  const deadline = Date.now() + HANDLER_MS;

  while (Date.now() < deadline) {
    if (Date.now() - lastLeaseCheck >= LEASE_CHECK_MS) {
      const channel = await getDiscordChannel(state.channelId);

      if (!channel || !isLeaseCurrent(channel, state.leaseToken)) {
        console.log('[chitchat-ai] worker lease is no longer current; stopping.');
        return cursor;
      }

      lastLeaseCheck = Date.now();
    }

    const messages = (await getDiscordChannelMessages(state.channelId, {
      limit: 100,
      after: cursor,
    })) as DiscordMessage[];

    for (const message of sortOldestFirst(messages)) {
      if (!message.id || message.id === cursor) {
        continue;
      }

      if (
        !message.author?.id ||
        message.author.id === botUserId ||
        message.author.bot
      ) {
        cursor = message.id;
        continue;
      }

      const content =
        typeof message.content === 'string' ? message.content.trim() : '';

      if (!content) {
        cursor = message.id;
        continue;
      }

      const prompt = content
        .replaceAll('<@' + botUserId + '>', '')
        .replaceAll('<@!' + botUserId + '>', '')
        .trim();

      if (!prompt) {
        await sendReply(
          state.channelId,
          message.id,
          message.author.id,
          'Hi! Send me your question or message here and I will help you.',
        );
        cursor = message.id;
        continue;
      }

      const history = (await getDiscordChannelMessages(state.channelId, {
        limit: 12,
      })) as DiscordMessage[];

      const aiMessages = buildHistory(history, botUserId, message.id);
      aiMessages.push({
        role: 'user',
        content: prompt,
      });

      try {
        const answer = await generateChitchatAI(aiMessages);
        const currentChannel = await getDiscordChannel(state.channelId);

        if (
          !currentChannel ||
          !isLeaseCurrent(currentChannel, state.leaseToken)
        ) {
          return cursor;
        }

        await sendReply(
          state.channelId,
          message.id,
          message.author.id,
          answer,
        );
      } catch (error) {
        console.error('[chitchat-ai] response failed:', error);

        const currentChannel = await getDiscordChannel(state.channelId).catch(
          () => null,
        );

        if (
          currentChannel &&
          isLeaseCurrent(currentChannel, state.leaseToken)
        ) {
          await sendReply(
            state.channelId,
            message.id,
            message.author.id,
            'I could not generate a response right now. Please try again in a moment.',
          ).catch(() => {});
        }
      }

      cursor = message.id;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return cursor;
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ok: false}, {status: 401});
    }

    const body = await request.json();
    const state: WorkerState = {
      channelId:
        typeof body?.channelId === 'string' ? body.channelId.trim() : '',
      leaseToken:
        typeof body?.leaseToken === 'string' ? body.leaseToken.trim() : '',
      cursor: typeof body?.cursor === 'string' ? body.cursor.trim() : '',
      baseUrl:
        typeof body?.baseUrl === 'string'
          ? body.baseUrl.replace(/\/$/, '')
          : '',
    };

    if (
      !state.channelId ||
      !state.leaseToken ||
      !state.cursor ||
      !state.baseUrl
    ) {
      return NextResponse.json(
        {ok: false, error: 'Invalid worker state.'},
        {status: 400},
      );
    }

    const cursor = await runWorker(state);

    return NextResponse.json({ok: true, cursor});
  } catch (error) {
    console.error('[chitchat-ai] worker failed:', error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : 'Unknown worker error.',
      },
      {status: 500},
    );
  }
}
