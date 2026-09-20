import { sleep } from 'workflow';
import {
  getBotUserId,
  getChitchatAiChatChannel,
  getDiscordChannelMessages,
  sendDiscordChannelMessage,
} from '@/lib/discord';
import { generateChitchatAI, type ChitchatAIMessage } from '@/lib/ai';

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

async function findAiChannelStep(guildId: string) {
  'use step';
  return await getChitchatAiChatChannel(guildId);
}

async function getBotUserIdStep() {
  'use step';
  return await getBotUserId();
}

async function getRecentMessagesStep(channelId: string, after?: string | null) {
  'use step';
  return await getDiscordChannelMessages(channelId, {
    limit: 50,
    after: after ?? undefined,
  });
}

async function getHistoryStep(channelId: string) {
  'use step';
  return await getDiscordChannelMessages(channelId, {limit: 12});
}

async function generateReplyStep(messages: ChitchatAIMessage[]) {
  'use step';
  return await generateChitchatAI(messages);
}

async function sendReplyStep(
  channelId: string,
  messageId: string,
  userId: string,
  responseText: string,
) {
  'use step';

  const chunks: string[] = [];
  for (let index = 0; index < responseText.length; index += 1900) {
    chunks.push(responseText.slice(index, index + 1900));
  }

  for (const [index, chunk] of chunks.entries()) {
    await sendDiscordChannelMessage(channelId, {
      content: index === 0 ? `<@${userId}> ${chunk}` : chunk,
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

function sortOldestFirst(messages: DiscordMessage[]) {
  return [...messages].sort((a, b) => {
    try {
      return Number(BigInt(a.id) - BigInt(b.id));
    } catch {
      return a.id.localeCompare(b.id);
    }
  });
}

function buildHistory(
  messages: DiscordMessage[],
  botUserId: string,
): ChitchatAIMessage[] {
  return sortOldestFirst(messages)
    .filter(
      (message) =>
        typeof message.content === 'string' && message.content.trim(),
    )
    .slice(-10)
    .map((message) => {
      const content = message.content!.trim();

      if (message.author?.id === botUserId || message.author?.bot) {
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
        content: `${displayName}: ${content}`,
      };
    });
}

export async function chitchatAiDaemon(guildId: string) {
  'use workflow';

  const channel = await findAiChannelStep(guildId);
  if (!channel) {
    throw new Error('The ╌✦🤖ai-chat channel was not found in CHITCHAT.');
  }

  const botUserId = await getBotUserIdStep();
  const initialMessages = (await getRecentMessagesStep(
    channel.id,
    null,
  )) as DiscordMessage[];
  const initialSorted = sortOldestFirst(initialMessages);

  // Start after the latest existing message so enabling the daemon never
  // causes the bot to reply to old messages.
  let lastSeenMessageId = initialSorted.at(-1)?.id ?? null;

  while (true) {
    try {
      const messages = (await getRecentMessagesStep(
        channel.id,
        lastSeenMessageId,
      )) as DiscordMessage[];

      for (const message of sortOldestFirst(messages)) {
        lastSeenMessageId = message.id;

        if (
          !message.author?.id ||
          message.author.id === botUserId ||
          message.author.bot ||
          typeof message.content !== 'string' ||
          !message.content.trim()
        ) {
          continue;
        }

        const history = (await getHistoryStep(channel.id)) as DiscordMessage[];
        const aiMessages = buildHistory(history, botUserId);

        // The just-received message is the user turn being answered.
        aiMessages.push({
          role: 'user',
          content: message.content.trim(),
        });

        try {
          const answer = await generateReplyStep(aiMessages);
          await sendReplyStep(
            channel.id,
            message.id,
            message.author.id,
            answer,
          );
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : 'Unknown AI error';

          console.error('[chitchat-ai] response failed:', detail);

          // Keep the public error message intentionally generic so secrets
          // or provider details never leak into the Discord channel.
          await sendReplyStep(
            channel.id,
            message.id,
            message.author.id,
            'I could not generate a response right now. Please try again in a moment.',
          ).catch(() => {});
        }
      }
    } catch (error) {
      console.error('[chitchat-ai] polling failed:', error);
    }

    await sleep('3s');
  }
}
