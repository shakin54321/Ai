import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';
import {
  LEVEL_DATA_PREFIX,
  LEVEL_DATA_CHANNEL_NAME,
  LEADERBOARD_CHANNEL_NAME,
  LEVEL_UP_CHANNEL_NAME,
  GET_ROLE_CHANNEL_NAME,
  levelFromXp,
  levelRoleName,
  readLevelStore,
  setupLevelSystem,
  xpForLevel,
  type StoredLevelUser,
} from '@/lib/level-system';
import {
  editDiscordChannelMessage,
  getBotUserId,
  getDiscordChannelMessages,
  getGuildChannels,
  getGuildMember,
  getGuildRoles,
  sendDiscordChannelMessage,
} from '@/lib/discord';

export const runtime = 'nodejs';
export const maxDuration = 240;

type DiscordMessage = {
  id: string;
  content?: string;
  author?: {
    id?: string;
    username?: string;
    global_name?: string | null;
    avatar?: string | null;
    bot?: boolean;
  };
  channel_id?: string;
};

type LevelWorkerState = {
  guildId: string;
  dataChannelId: string;
  cursors: Record<string, string>;
  users: Record<string, StoredLevelUser>;
  dataMessageIds: Record<string, string>;
  leaderboardMessageId?: string;
  leaseToken: string;
  baseUrl: string;
};

const POLL_MS = 2000;
const HANDLER_MS = 100000;
const LEADERBOARD_EVERY_LOOPS = 15;

const STATIC_CHANNELS = new Set([
  normalize(LEVEL_DATA_CHANNEL_NAME),
  normalize(LEVEL_UP_CHANNEL_NAME),
  normalize(LEADERBOARD_CHANNEL_NAME),
  normalize(GET_ROLE_CHANNEL_NAME),
  'VERIFYHERE',
  'WELCOME',
  'ANNOUNCEMENT',
  'SABANNOUNCEMENT',
]);

function normalize(name?: string | null) {
  return (name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isRankCommandChannel(channel: any) {
  const normalized = normalize(channel?.name);
  return (
    normalized === normalize(LEVEL_UP_CHANNEL_NAME) ||
    normalized === normalize(LEADERBOARD_CHANNEL_NAME) ||
    normalized === normalize(GET_ROLE_CHANNEL_NAME)
  );
}

function isCountableChannel(channel: any) {
  if (typeof channel?.name !== 'string' || channel.type !== 0) return false;
  const normalized = normalize(channel.name);

  if (STATIC_CHANNELS.has(normalized)) return false;
  if (normalized.startsWith('MEMBERS') && /\\d+$/.test(normalized)) return false;
  if (normalized.includes('STATUS') && normalized.includes('ONLINE')) return false;
  if (normalized.includes('DONATION') && normalized.includes('LOG')) return false;

  return true;
}

function avatarUrl(userId: string, avatar?: string | null) {
  if (!avatar) return null;
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) return avatar;
  const extension = avatar.startsWith('a_') ? 'gif' : 'png';
  return 'https://cdn.discordapp.com/avatars/' + userId + '/' + avatar + '.' + extension + '?size=256';
}

function workerSecret() {
  const value = process.env.DISCORD_SETUP_SECRET?.trim();
  if (!value) throw new Error('DISCORD_SETUP_SECRET is required for the level worker.');
  return value;
}

function isAuthorized(request: NextRequest) {
  return request.headers.get('authorization') === 'Bearer ' + workerSecret();
}

function isLeaseCurrent(channel: any, leaseToken: string) {
  return (channel?.topic ?? '') === 'CHITCHAT_LEVEL_WORKER:' + leaseToken;
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

async function persistUser(
  state: LevelWorkerState,
  user: StoredLevelUser,
) {
  const content =
    LEVEL_DATA_PREFIX +
    JSON.stringify({
      userId: user.userId,
      xp: user.xp,
      messages: user.messages,
      displayName: user.displayName.slice(0, 80),
      avatar: user.avatar ?? null,
    });

  const messageId = state.dataMessageIds[user.userId];

  if (messageId) {
    try {
      await editDiscordChannelMessage(state.dataChannelId, messageId, {content});
      return messageId;
    } catch {}
  }

  const created = await sendDiscordChannelMessage(state.dataChannelId, {
    content,
    allowed_mentions: {parse: []},
  });

  return String(created.id);
}

function makeProgress(xp: number) {
  const level = levelFromXp(xp);
  const floor = level === 0 ? 0 : xpForLevel(level);
  const next = level < 100 ? xpForLevel(level + 1) : xpForLevel(100);
  const ratio =
    level >= 100
      ? 1
      : Math.max(0, Math.min(1, (xp - floor) / Math.max(1, next - floor)));
  const filled = level >= 100 ? 12 : Math.round(ratio * 12);

  return {
    level,
    next,
    bar: '█'.repeat(filled) + '░'.repeat(12 - filled),
  };
}

async function updateLeaderboard(
  state: LevelWorkerState,
  users: StoredLevelUser[],
  botUserId: string,
) {
  const sorted = [...users]
    .sort(
      (a, b) =>
        b.xp - a.xp ||
        b.messages - a.messages ||
        a.userId.localeCompare(b.userId),
    )
    .slice(0, 10);

  const lines = sorted.length
    ? sorted.map((user, index) => {
        const progress = makeProgress(user.xp);
        return (
          '**#' +
          (index + 1) +
          '** <@' +
          user.userId +
          '> — Level **' +
          progress.level +
          '** • **' +
          user.xp.toLocaleString('en-US') +
          ' XP**'
        );
      })
    : ['No XP has been earned yet. Start chatting to appear here.'];

  const payload = {
    embeds: [{
      title: 'LIVE LEADERBOARD',
      description: lines.join('\n'),
      color: 0xa855f7,
      footer: {text: 'CHITCHAT • XP Leaderboard • Updates automatically'},
    }],
  };

  if (state.leaderboardMessageId) {
    try {
      await editDiscordChannelMessage(
        state.leaderboardMessageId.split(':')[0],
        state.leaderboardMessageId.split(':')[1],
        payload,
      );
      return state.leaderboardMessageId;
    } catch {}
  }

  const channels = await getGuildChannels(state.guildId);
  const leaderboardChannel = channels.find(
    (item) => normalize(item.name) === normalize(LEADERBOARD_CHANNEL_NAME),
  );

  if (!leaderboardChannel) return undefined;

  const existing = (
    await getDiscordChannelMessages(leaderboardChannel.id, {limit: 100})
  ) as Array<any>;

  const existingBot = existing.find(
    (message) =>
      message.author?.id === botUserId &&
      message.embeds?.[0]?.title === 'LIVE LEADERBOARD',
  );

  if (existingBot?.id) {
    await editDiscordChannelMessage(leaderboardChannel.id, existingBot.id, payload);
    return leaderboardChannel.id + ':' + existingBot.id;
  }

  const created = await sendDiscordChannelMessage(
    leaderboardChannel.id,
    payload,
  );
  return leaderboardChannel.id + ':' + String(created.id);
}

async function sendLevelUp(
  state: LevelWorkerState,
  user: StoredLevelUser,
  newLevel: number,
) {
  const channels = await getGuildChannels(state.guildId);
  const channel = channels.find(
    (item) => normalize(item.name) === normalize(LEVEL_UP_CHANNEL_NAME),
  );

  if (!channel) return;

  const roles = await getGuildRoles(state.guildId);
  const role = roles.find((item) => item.name === levelRoleName(newLevel));

  if (!role) return;

  await sendDiscordChannelMessage(channel.id, {
    content: '<@' + user.userId + '>',
    embeds: [{
      title: 'LEVEL UP',
      description: [
        'You reached **Level ' + newLevel + '**.',
        '',
        'Required XP: **' + xpForLevel(newLevel).toLocaleString('en-US') + ' XP**',
        'Unlocked role: <@&' + role.id + '>',
        '',
        'Go to the level role center and claim your unlocked role.',
      ].join('\n'),
      color: role.color ?? 0xa855f7,
      footer: {text: 'CHITCHAT • Level System'},
    }],
    allowed_mentions: {users: [user.userId]},
  });
}

async function initializeState(guildId: string, baseUrl: string): Promise<LevelWorkerState> {
  await setupLevelSystem(guildId);

  const channels = await getGuildChannels(guildId);
  const dataChannel = channels.find(
    (channel) =>
      normalize(channel.name) === normalize(LEVEL_DATA_CHANNEL_NAME),
  );

  if (!dataChannel) {
    throw new Error('Level data channel is missing. Run level setup again.');
  }

  const stored = await readLevelStore(guildId, dataChannel.id);
  const cursors: Record<string, string> = {};

  for (const channel of channels.filter(
    (item) => isCountableChannel(item) || isRankCommandChannel(item),
  )) {
    const messages = (await getDiscordChannelMessages(channel.id, {
      limit: 1,
    })) as DiscordMessage[];
    cursors[channel.id] = messages[0]?.id ?? '';
  }

  const users: Record<string, StoredLevelUser> = {};
  for (const [userId, user] of stored.users.entries()) {
    users[userId] = user;
  }

  const dataMessageIds: Record<string, string> = {};
  for (const [userId, messageId] of stored.messageIds.entries()) {
    dataMessageIds[userId] = messageId;
  }

  return {
    guildId,
    dataChannelId: dataChannel.id,
    cursors,
    users,
    dataMessageIds,
    leaseToken: crypto.randomUUID(),
    baseUrl,
  };
}

async function processLoop(state: LevelWorkerState) {
  const botUserId = await getBotUserId();
  let loops = 0;
  let cursorState = {...state};

  const currentDataChannel = await getGuildChannels(cursorState.guildId);
  const dataChannel = currentDataChannel.find(
    (channel) => channel.id === cursorState.dataChannelId,
  );

  if (
    !dataChannel ||
    !isLeaseCurrent(dataChannel, cursorState.leaseToken)
  ) {
    throw new Error('The level worker lease is no longer current.');
  }

  const deadline = Date.now() + HANDLER_MS;

  while (Date.now() < deadline) {
    const channels = await getGuildChannels(cursorState.guildId);
    const candidates = channels.filter(
      (item) => isCountableChannel(item) || isRankCommandChannel(item),
    );

    for (const channel of candidates) {
      const previous = cursorState.cursors[channel.id] || undefined;
      const messages = (await getDiscordChannelMessages(channel.id, {
        limit: 100,
        after: previous,
      })) as DiscordMessage[];

      for (const message of sortOldestFirst(messages)) {
        if (!message.id) continue;
        cursorState.cursors[channel.id] = message.id;

        if (
          !message.author?.id ||
          message.author.bot ||
          message.author.id === botUserId
        ) {
          continue;
        }

        const content =
          typeof message.content === 'string' ? message.content.trim() : '';
        if (!content) continue;

        if (isRankCommandChannel(channel) && content.toLowerCase() === '!rank') {
          continue;
        }

        const userId = message.author.id;
        const existing = cursorState.users[userId] ?? {
          userId,
          xp: 0,
          messages: 0,
          displayName:
            message.author.global_name ||
            message.author.username ||
            'Member',
          avatar: null,
        };

        existing.displayName =
          message.author.global_name ||
          message.author.username ||
          existing.displayName;

        const freshAvatar = avatarUrl(userId, message.author.avatar);
        if (freshAvatar) existing.avatar = freshAvatar;

        existing.messages += 1;
        cursorState.users[userId] = existing;

        if (existing.messages % 5 !== 0) continue;

        const previousXp = existing.xp;
        existing.xp += 10;

        cursorState.dataMessageIds[userId] = await persistUser(
          cursorState,
          existing,
        );

        const previousLevel = levelFromXp(previousXp);
        const newLevel = levelFromXp(existing.xp);

        if (newLevel > previousLevel) {
          await sendLevelUp(cursorState, existing, newLevel).catch((error) =>
            console.error('[level-worker] level-up send failed:', error),
          );
        }
      }
    }

    loops += 1;

    if (loops % LEADERBOARD_EVERY_LOOPS === 0) {
      const leaderboard = await updateLeaderboard(
        cursorState,
        Object.values(cursorState.users),
        botUserId,
      ).catch((error) => {
        console.error('[level-worker] leaderboard update failed:', error);
        return cursorState.leaderboardMessageId;
      });

      if (leaderboard) cursorState.leaderboardMessageId = leaderboard;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return cursorState;
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ok: false}, {status: 401});
    }

    const body = await request.json();

    let state: LevelWorkerState;
    if (body?.initialize === true) {
      state = await initializeState(
        String(body.guildId ?? ''),
        String(body.baseUrl ?? request.nextUrl.origin).replace(/\\/$/, ''),
      );

      const channels = await getGuildChannels(state.guildId);
      const dataChannel = channels.find(
        (channel) => channel.id === state.dataChannelId,
      );
      if (!dataChannel) throw new Error('Level data channel was not found.');

      const leasedTopic = 'CHITCHAT_LEVEL_WORKER:' + state.leaseToken;
      const current = dataChannel.topic ?? '';

      if (current !== leasedTopic) {
        const {modifyChannel} = await import('@/lib/discord');
        await modifyChannel(state.dataChannelId, {topic: leasedTopic});
      }
    } else {
      state = {
        guildId: typeof body?.guildId === 'string' ? body.guildId : '',
        dataChannelId:
          typeof body?.dataChannelId === 'string' ? body.dataChannelId : '',
        cursors:
          body?.cursors && typeof body.cursors === 'object'
            ? body.cursors
            : {},
        users:
          body?.users && typeof body.users === 'object'
            ? body.users
            : {},
        dataMessageIds:
          body?.dataMessageIds && typeof body.dataMessageIds === 'object'
            ? body.dataMessageIds
            : {},
        leaderboardMessageId:
          typeof body?.leaderboardMessageId === 'string'
            ? body.leaderboardMessageId
            : undefined,
        leaseToken:
          typeof body?.leaseToken === 'string' ? body.leaseToken : '',
        baseUrl:
          typeof body?.baseUrl === 'string'
            ? body.baseUrl.replace(/\\/$/, '')
            : request.nextUrl.origin,
      };
    }

    if (!state.guildId || !state.dataChannelId || !state.leaseToken) {
      return NextResponse.json(
        {ok: false, error: 'Invalid level worker state.'},
        {status: 400},
      );
    }

    const nextState = await processLoop(state);

    after(async () => {
      try {
        const response = await fetch(
          nextState.baseUrl + '/api/discord/level-worker',
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + workerSecret(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(nextState),
            cache: 'no-store',
          },
        );

        if (!response.ok) {
          console.error(
            '[level-worker] handoff failed:',
            response.status,
            await response.text().catch(() => ''),
          );
        }
      } catch (error) {
        console.error('[level-worker] handoff error:', error);
      }
    });

    return NextResponse.json({ok: true});
  } catch (error) {
    console.error('[level-worker] failed:', error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : 'Unknown level worker error.',
      },
      {status: 500},
    );
  }
}
