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
} from '@/lib/level-system';
import {
  editDiscordChannelMessage,
  getBotUserId,
  getDiscordChannelMessages,
  getGuildChannels,
  getGuildRoles,
  modifyChannel,
  sendDiscordChannelMessage,
} from '@/lib/discord';

export const runtime = 'nodejs';
export const maxDuration = 240;

const POLL_MS = 2000;
const HANDLER_MS = 100000;

function normalize(name: any) {
  return String(name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isRankChannel(channel: any) {
  const name = normalize(channel?.name);
  return name === normalize(LEVEL_UP_CHANNEL_NAME) ||
    name === normalize(LEADERBOARD_CHANNEL_NAME) ||
    name === normalize(GET_ROLE_CHANNEL_NAME);
}

function isCountable(channel: any) {
  if (!channel || channel.type !== 0 || typeof channel.name !== 'string') return false;
  const name = normalize(channel.name);
  if (name === normalize(LEVEL_DATA_CHANNEL_NAME)) return false;
  if (name === normalize(LEVEL_UP_CHANNEL_NAME)) return false;
  if (name === normalize(LEADERBOARD_CHANNEL_NAME)) return false;
  if (name === normalize(GET_ROLE_CHANNEL_NAME)) return false;
  if (name === 'VERIFYHERE' || name === 'WELCOME') return false;
  if (name === 'ANNOUNCEMENT' || name === 'SABANNOUNCEMENT') return false;
  if (name.startsWith('MEMBERS') && /\d+$/.test(name)) return false;
  if (name.includes('STATUS') && name.includes('ONLINE')) return false;
  if (name.includes('DONATION') && name.includes('LOG')) return false;
  return true;
}

function oldest(messages: any[]) {
  return [...messages].sort((a, b) => {
    try { return Number(BigInt(a.id) - BigInt(b.id)); }
    catch { return String(a.id).localeCompare(String(b.id)); }
  });
}

function workerSecret() {
  const value = process.env.DISCORD_SETUP_SECRET?.trim();
  if (!value) throw new Error('DISCORD_SETUP_SECRET is not configured in Vercel.');
  return value;
}

function authorized(request: NextRequest) {
  return request.headers.get('authorization') === 'Bearer ' + workerSecret();
}

function progress(xp: number) {
  const level = levelFromXp(xp);
  const floor = level === 0 ? 0 : xpForLevel(level);
  const next = level < 100 ? xpForLevel(level + 1) : xpForLevel(100);
  const ratio = level >= 100 ? 1 : Math.max(0, Math.min(1, (xp - floor) / Math.max(1, next - floor)));
  const filled = level >= 100 ? 12 : Math.round(ratio * 12);
  return {level, bar: '█'.repeat(filled) + '░'.repeat(12 - filled), next};
}

async function saveUser(state: any, user: any) {
  const content = LEVEL_DATA_PREFIX + JSON.stringify({
    userId: user.userId,
    xp: user.xp,
    messages: user.messages,
    displayName: String(user.displayName ?? 'Member').slice(0, 80),
    avatar: user.avatar ?? null,
  });

  const oldId = state.dataMessageIds[user.userId];
  if (oldId) {
    try {
      await editDiscordChannelMessage(state.dataChannelId, oldId, {content});
      return oldId;
    } catch {}
  }

  const created = await sendDiscordChannelMessage(state.dataChannelId, {
    content,
    allowed_mentions: {parse: []},
  });
  return String(created.id);
}

async function updateLeaderboard(state: any, botUserId: string) {
  const channels = await getGuildChannels(state.guildId);
  const channel = channels.find((item) => normalize(item.name) === normalize(LEADERBOARD_CHANNEL_NAME));
  if (!channel) return state.leaderboardMessageId;

  const users: any[] = Object.values(state.users ?? {})
    .sort((a: any, b: any) => b.xp - a.xp || b.messages - a.messages || String(a.userId).localeCompare(String(b.userId)))
    .slice(0, 10);

  const description = users.length
    ? users.map((user, index) => {
        const p = progress(user.xp);
        return '**#' + (index + 1) + '** <@' + user.userId + '> — Level **' + p.level +
          '** • **' + Number(user.xp).toLocaleString('en-US') + ' XP**';
      }).join('\n')
    : 'No XP has been earned yet. Start chatting to appear here.';

  const payload = {
    embeds: [{
      title: 'LIVE LEADERBOARD',
      description,
      color: 0xa855f7,
      footer: {text: 'CHITCHAT • XP Leaderboard • Updates automatically'},
    }],
  };

  if (state.leaderboardMessageId) {
    const parts = String(state.leaderboardMessageId).split(':');
    if (parts.length === 2) {
      try {
        await editDiscordChannelMessage(parts[0], parts[1], payload);
        return state.leaderboardMessageId;
      } catch {}
    }
  }

  const messages = await getDiscordChannelMessages(channel.id, {limit: 100}) as any[];
  const existing = messages.find((message) =>
    message.author?.id === botUserId &&
    message.embeds?.[0]?.title === 'LIVE LEADERBOARD',
  );

  if (existing?.id) {
    await editDiscordChannelMessage(channel.id, existing.id, payload);
    return channel.id + ':' + existing.id;
  }

  const created = await sendDiscordChannelMessage(channel.id, payload);
  return channel.id + ':' + String(created.id);
}

async function sendLevelUp(state: any, user: any, level: number) {
  const channels = await getGuildChannels(state.guildId);
  const channel = channels.find((item) => normalize(item.name) === normalize(LEVEL_UP_CHANNEL_NAME));
  if (!channel) return;

  const roles = await getGuildRoles(state.guildId);
  const role = roles.find((item) => item.name === levelRoleName(level));
  if (!role) return;

  await sendDiscordChannelMessage(channel.id, {
    content: '<@' + user.userId + '>',
    embeds: [{
      title: 'LEVEL UP',
      description: [
        'You reached **Level ' + level + '**.',
        '',
        'Required XP: **' + xpForLevel(level).toLocaleString('en-US') + ' XP**',
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

async function initialize(guildId: string, baseUrl: string) {
  await setupLevelSystem(guildId);

  const channels = await getGuildChannels(guildId);
  const dataChannel = channels.find((item) => normalize(item.name) === normalize(LEVEL_DATA_CHANNEL_NAME));
  if (!dataChannel) throw new Error('Level data channel is missing.');

  const store = await readLevelStore(guildId, dataChannel.id);
  const cursors: any = {};

  for (const channel of channels.filter((item) => isCountable(item) || isRankChannel(item))) {
    const recent = await getDiscordChannelMessages(channel.id, {limit: 1}) as any[];
    cursors[channel.id] = recent[0]?.id ?? '';
  }

  const users: any = {};
  const dataMessageIds: any = {};
  for (const [userId, user] of store.users.entries()) users[userId] = user;
  for (const [userId, messageId] of store.messageIds.entries()) dataMessageIds[userId] = messageId;

  const leaseToken = crypto.randomUUID();
  await modifyChannel(dataChannel.id, {topic: 'CHITCHAT_LEVEL_WORKER:' + leaseToken});

  return {
    guildId,
    dataChannelId: dataChannel.id,
    cursors,
    users,
    dataMessageIds,
    leaderboardMessageId: '',
    leaseToken,
    baseUrl,
  };
}

async function run(state: any) {
  const botUserId = await getBotUserId();
  let current = state;
  let loops = 0;
  const deadline = Date.now() + HANDLER_MS;

  while (Date.now() < deadline) {
    const channels = await getGuildChannels(current.guildId);
    const dataChannel = channels.find((item) => item.id === current.dataChannelId);
    if (!dataChannel || dataChannel.topic !== 'CHITCHAT_LEVEL_WORKER:' + current.leaseToken) return current;

    for (const channel of channels.filter((item) => isCountable(item) || isRankChannel(item))) {
      const after = current.cursors[channel.id] || undefined;
      const messages = await getDiscordChannelMessages(channel.id, {limit: 100, after}) as any[];

      for (const message of oldest(messages)) {
        current.cursors[channel.id] = message.id;

        if (!message.author?.id || message.author.bot || message.author.id === botUserId) continue;

        const content = typeof message.content === 'string' ? message.content.trim() : '';
        if (!content) continue;
        if (isRankChannel(channel) && content.toLowerCase() === '!rank') continue;

        const userId = message.author.id;
        const user = current.users[userId] ?? {
          userId,
          xp: 0,
          messages: 0,
          displayName: message.author.global_name || message.author.username || 'Member',
          avatar: null,
        };

        user.messages += 1;
        user.displayName = message.author.global_name || message.author.username || user.displayName;
        current.users[userId] = user;

        if (user.messages % 5 !== 0) continue;

        const previousXp = user.xp;
        user.xp += 10;
        current.dataMessageIds[userId] = await saveUser(current, user);

        const previousLevel = levelFromXp(previousXp);
        const newLevel = levelFromXp(user.xp);
        if (newLevel > previousLevel) {
          await sendLevelUp(current, user, newLevel).catch((error) => console.error('[level-worker] level-up failed:', error));
        }
      }
    }

    loops += 1;
    if (loops % 15 === 0) {
      current.leaderboardMessageId = await updateLeaderboard(current, botUserId).catch((error) => {
        console.error('[level-worker] leaderboard update failed:', error);
        return current.leaderboardMessageId;
      });
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return current;
}

export async function POST(request: NextRequest) {
  try {
    if (!authorized(request)) return NextResponse.json({ok: false}, {status: 401});

    const body = await request.json();
    let state: any;

    if (body?.initialize === true) {
      state = await initialize(
        String(body.guildId ?? ''),
        String(body.baseUrl ?? request.nextUrl.origin).replace(/\/$/, ''),
      );
    } else {
      state = body;
    }

    if (!state?.guildId || !state?.dataChannelId || !state?.leaseToken) {
      return NextResponse.json({ok: false, error: 'Invalid level worker state.'}, {status: 400});
    }

    const next = await run(state);

    after(async () => {
      try {
        const response = await fetch(next.baseUrl + '/api/discord/level-worker', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + workerSecret(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(next),
          cache: 'no-store',
        });
        if (!response.ok) console.error('[level-worker] handoff failed:', response.status);
      } catch (error) {
        console.error('[level-worker] handoff error:', error);
      }
    });

    return NextResponse.json({ok: true});
  } catch (error) {
    console.error('[level-worker] failed:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error.',
    }, {status: 500});
  }
}
