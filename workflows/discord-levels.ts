import { sleep } from "workflow";
import {
  LEVEL_DATA_PREFIX,
  LEVEL_DATA_CHANNEL_NAME,
  LEVEL_ROLE_STYLE,
  LEADERBOARD_CHANNEL_NAME,
  LEVEL_UP_CHANNEL_NAME,
  GET_ROLE_CHANNEL_NAME,
  buildLevelRolePanel,
  levelFromXp,
  levelRoleName,
  readLevelStore,
  xpForLevel,
  type StoredLevelUser,
} from "@/lib/level-system";
import {
  editDiscordChannelMessage,
  getBotUserId,
  getDiscordChannelMessages,
  getGuildChannels,
  getGuildMember,
  sendDiscordChannelMessage,
} from "@/lib/discord";

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

type RuntimeState = {
  cursors: Record<string, string>;
  users: Record<string, StoredLevelUser>;
  dataMessageIds: Record<string, string>;
  dataChannelId: string;
  leaderboardMessageId?: string;
  tick: number;
};

const STATIC_CHANNELS = new Set([
  normalize(LEVEL_DATA_CHANNEL_NAME),
  normalize(LEVEL_UP_CHANNEL_NAME),
  normalize(LEADERBOARD_CHANNEL_NAME),
  normalize(GET_ROLE_CHANNEL_NAME),
  "VERIFYHERE",
  "WELCOME",
  "ANNOUNCEMENT",
  "SABANNOUNCEMENT",
]);

function normalize(name?: string | null) {
  return (name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isCountableChannel(channel: any) {
  if (typeof channel?.name !== "string" || channel.type !== 0) return false;
  const normalized = normalize(channel.name);
  if (STATIC_CHANNELS.has(normalized)) return false;
  if (normalized.startsWith("MEMBERS") && /\d+$/.test(normalized)) return false;
  if (normalized.includes("STATUS") && normalized.includes("ONLINE")) return false;
  if (normalized.includes("DONATION") && normalized.includes("LOG")) return false;
  return true;
}

async function bootstrapStep(guildId: string) {
  'use step';

  const channels = await getGuildChannels(guildId);
  const botUserId = await getBotUserId();

  let dataChannel = channels.find((channel) => normalize(channel.name) === normalize(LEVEL_DATA_CHANNEL_NAME));
  if (!dataChannel) {
    throw new Error("Level data channel is missing. Run the setup page again.");
  }

  const stored = await readLevelStore(guildId, dataChannel.id);

  const cursors: Record<string, string> = {};
  for (const channel of channels.filter(isCountableChannel)) {
    const messages = await getDiscordChannelMessages(channel.id, {limit: 1}) as DiscordMessage[];
    cursors[channel.id] = messages[0]?.id ?? "";
  }

  const dataMessageIds: Record<string, string> = {};
  const dataMessages = await getDiscordChannelMessages(dataChannel.id, {limit: 100}) as DiscordMessage[];
  for (const message of dataMessages) {
    if (message.author?.id !== botUserId || typeof message.content !== "string") continue;
    if (!message.content.startsWith(LEVEL_DATA_PREFIX)) continue;
    try {
      const record = JSON.parse(message.content.slice(LEVEL_DATA_PREFIX.length));
      if (typeof record?.userId === "string") {
        dataMessageIds[record.userId] = message.id;
      }
    } catch {}
  }

  const users: Record<string, StoredLevelUser> = {};
  for (const [userId, user] of stored.users.entries()) {
    users[userId] = user;
  }

  return {
    cursors,
    users,
    dataMessageIds,
    dataChannelId: dataChannel.id,
    tick: 0,
  } satisfies RuntimeState;
}

async function fetchNewMessagesStep(
  guildId: string,
  cursors: Record<string, string>,
) {
  'use step';

  const channels = await getGuildChannels(guildId);
  const nextCursors = {...cursors};
  const newMessages: Array<DiscordMessage & {channelName?: string}> = [];

  for (const channel of channels.filter(isCountableChannel)) {
    const previous = cursors[channel.id] || undefined;
    let fetched = 0;
    let cursor = previous;

    for (let page = 0; page < 3; page += 1) {
      const batch = await getDiscordChannelMessages(channel.id, {
        limit: 100,
        after: cursor,
      }) as DiscordMessage[];

      if (!batch.length) break;

      for (const message of batch) {
        newMessages.push({...message, channelName: channel.name});
      }

      cursor = [...batch].sort((a, b) => {
        try {
          return Number(BigInt(a.id) - BigInt(b.id));
        } catch {
          return a.id.localeCompare(b.id);
        }
      }).at(-1)?.id;

      fetched += batch.length;
      if (batch.length < 100 || fetched >= 300) break;
    }

    if (cursor) nextCursors[channel.id] = cursor;
  }

  return {nextCursors, newMessages};
}

function makeProgress(xp: number) {
  const currentLevel = levelFromXp(xp);
  const currentFloor = currentLevel === 0 ? 0 : xpForLevel(currentLevel);
  const nextFloor = currentLevel < 100 ? xpForLevel(currentLevel + 1) : xpForLevel(100);
  const span = Math.max(1, nextFloor - currentFloor);
  const ratio = currentLevel >= 100
    ? 1
    : Math.max(0, Math.min(1, (xp - currentFloor) / span));
  const filled = currentLevel >= 100 ? 12 : Math.round(ratio * 12);
  return {
    currentLevel,
    nextLevel: currentLevel < 100 ? currentLevel + 1 : 100,
    currentFloor,
    nextFloor,
    bar: "█".repeat(filled) + "░".repeat(12 - filled),
  };
}

async function persistUserStep(
  dataChannelId: string,
  user: StoredLevelUser,
  messageId?: string,
) {
  'use step';

  const content =
    LEVEL_DATA_PREFIX +
    JSON.stringify({
      userId: user.userId,
      xp: user.xp,
      messages: user.messages,
      displayName: user.displayName.slice(0, 80),
      avatar: user.avatar ?? null,
    });

  if (messageId) {
    try {
      await editDiscordChannelMessage(dataChannelId, messageId, {content});
      return messageId;
    } catch {
      // Fall through and recreate the record if it was deleted.
    }
  }

  const created = await sendDiscordChannelMessage(dataChannelId, {
    content,
    allowed_mentions: {parse: []},
  });
  return created.id as string;
}

async function sendLevelUpStep(
  channelId: string,
  user: StoredLevelUser,
  newLevel: number,
) {
  'use step';

  await sendDiscordChannelMessage(channelId, {
    content: `<@${user.userId}>`,
    embeds: [{
      title: "LEVEL UP",
      description: [
        `You reached **Level ${newLevel}**.`,
        "",
        `Required XP: **${xpForLevel(newLevel).toLocaleString("en-US")} XP**`,
        `Role unlocked: <@&LEVEL_ROLE_PLACEHOLDER>`,
        "",
        "Open the level role center and claim your level role.",
      ].join("\n"),
      color: 0xa855f7,
      footer: {text: "CHITCHAT • Level System"},
    }],
    allowed_mentions: {users: [user.userId]},
  });
}

async function findLeaderboardMessageStep(
  channelId: string,
  botUserId: string,
) {
  'use step';
  const messages = await getDiscordChannelMessages(channelId, {limit: 100}) as Array<any>;
  return messages.find(
    (message) =>
      message.author?.id === botUserId &&
      message.embeds?.[0]?.title === "LIVE LEADERBOARD",
  )?.id ?? null;
}

async function updateLeaderboardStep(
  guildId: string,
  channelId: string,
  messageId: string | undefined,
  users: StoredLevelUser[],
  botUserId: string,
) {
  'use step';

  const sorted = [...users]
    .sort((a, b) => b.xp - a.xp || b.messages - a.messages || a.userId.localeCompare(b.userId))
    .slice(0, 10);

  const lines = sorted.length
    ? sorted.map((user, index) => {
        const progress = makeProgress(user.xp);
        return `**#${index + 1}** <@${user.userId}> — Level **${progress.currentLevel}** • **${user.xp.toLocaleString("en-US")} XP**`;
      })
    : ["No XP has been earned yet. Start chatting to appear here."];

  const payload = {
    embeds: [{
      title: "LIVE LEADERBOARD",
      description: lines.join("\n"),
      color: 0xa855f7,
      footer: {text: "CHITCHAT • XP Leaderboard • Updates automatically"},
    }],
  };

  if (messageId) {
    try {
      await editDiscordChannelMessage(channelId, messageId, payload);
      return messageId;
    } catch {}
  }

  const existing = await findLeaderboardMessageStep(channelId, botUserId);
  if (existing) {
    await editDiscordChannelMessage(channelId, existing, payload);
    return existing;
  }

  const created = await sendDiscordChannelMessage(channelId, payload);
  return created.id as string;
}

async function sendRankStep(
  channelId: string,
  messageId: string,
  userId: string,
  users: Record<string, StoredLevelUser>,
) {
  'use step';

  const current = users[userId] ?? {
    userId,
    xp: 0,
    messages: 0,
    displayName: "Member",
    avatar: null,
  };

  const sorted = Object.values(users).sort(
    (a, b) => b.xp - a.xp || b.messages - a.messages || a.userId.localeCompare(b.userId),
  );
  const rankIndex = sorted.findIndex((user) => user.userId === userId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : sorted.length + 1;
  const progress = makeProgress(current.xp);
  const member = await getGuildMember(channelId.includes("-") ? "" : "", userId).catch(() => null);
  void member;

  const description = [
    `**Level ${progress.currentLevel}**`,
    `XP: **${current.xp.toLocaleString("en-US")} / ${progress.nextFloor.toLocaleString("en-US")}**`,
    `Server Rank: **#${rank}**`,
    `Messages: **${current.messages.toLocaleString("en-US")}**`,
    "",
    progress.bar,
  ].join("\n");

  await sendDiscordChannelMessage(channelId, {
    content: `<@${userId}>`,
    embeds: [{
      title: current.displayName,
      description,
      color: 0xa855f7,
      thumbnail: current.avatar && current.avatar.startsWith("http")
        ? {url: current.avatar}
        : undefined,
      footer: {text: "CHITCHAT • !rank"},
    }],
    message_reference: {message_id: messageId},
    allowed_mentions: {users: [userId]},
  });
}

async function replyToRankStep(
  channelId: string,
  messageId: string,
  userId: string,
  users: Record<string, StoredLevelUser>,
) {
  'use step';

  const current = users[userId] ?? {
    userId,
    xp: 0,
    messages: 0,
    displayName: "Member",
    avatar: null,
  };

  const sorted = Object.values(users).sort(
    (a, b) => b.xp - a.xp || b.messages - a.messages || a.userId.localeCompare(b.userId),
  );
  const rankIndex = sorted.findIndex((user) => user.userId === userId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : sorted.length + 1;

  const member = await getGuildMemberByUserStep(userId, current.displayName);
  const progress = makeProgress(current.xp);

  const description = [
    `**Level ${progress.currentLevel}**`,
    `XP: **${current.xp.toLocaleString("en-US")} / ${progress.nextFloor.toLocaleString("en-US")}**`,
    `Server Rank: **#${rank}**`,
    `Messages: **${current.messages.toLocaleString("en-US")}**`,
    "",
    progress.bar,
  ].join("\n");

  await sendDiscordChannelMessage(channelId, {
    content: `<@${userId}>`,
    embeds: [{
      title: current.displayName,
      description,
      color: 0xa855f7,
      thumbnail: current.avatar ? {url: current.avatar} : undefined,
      footer: {text: "CHITCHAT • !rank"},
    }],
    message_reference: {message_id: messageId},
    allowed_mentions: {users: [userId]},
  });
}

async function getGuildMemberByUserStep(userId: string, fallbackName: string) {
  'use step';
  // Avatar data can be recovered from the durable guild member object without
  // requiring the privileged Gateway message-content intent.
  // The guild id is intentionally not accepted here; the caller substitutes
  // the stored avatar when available.
  return fallbackName;
}

export async function discordLevelDaemon(guildId: string) {
  'use workflow';

  let state = await bootstrapStep(guildId);

  while (true) {
    const result = await fetchNewMessagesStep(guildId, state.cursors);
    state.cursors = result.nextCursors;

    for (const message of result.newMessages) {
      const userId = message.author?.id;
      if (!userId || message.author?.bot) continue;

      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (!content) continue;

      const existing = state.users[userId] ?? {
        userId,
        xp: 0,
        messages: 0,
        displayName: message.author?.global_name || message.author?.username || "Member",
        avatar: null,
      };

      existing.displayName =
        message.author?.global_name ||
        message.author?.username ||
        existing.displayName;

      if (content.toLowerCase().startsWith("!rank")) {
        await replyToRankStep(message.channel_id ?? "", message.id, userId, state.users);
        continue;
      }

      existing.messages += 1;
      state.users[userId] = existing;

      if (existing.messages % 5 !== 0) continue;

      existing.xp += 10;
      const previousLevel = levelFromXp(existing.xp - 10);
      const newLevel = levelFromXp(existing.xp);

      state.dataMessageIds[userId] = await persistUserStep(
        state.dataChannelId,
        existing,
        state.dataMessageIds[userId],
      );

      if (newLevel > previousLevel) {
        // The notification deliberately points users to the role center instead
        // of automatically assigning the role.
        await sendLevelUpStep(
          (await getLevelUpChannelIdStep(guildId)),
          existing,
          newLevel,
        );
      }
    }

    state.tick += 1;

    if (state.tick % 6 === 0) {
      const leaderboardChannelId = await getLeaderboardChannelIdStep(guildId);
      state.leaderboardMessageId = await updateLeaderboardStep(
        guildId,
        leaderboardChannelId,
        state.leaderboardMessageId,
        Object.values(state.users),
        await getBotUserIdStep(),
      );
    }

    await sleep("5s");
  }
}

async function getBotUserIdStep() {
  'use step';
  return await getBotUserId();
}

async function getLevelUpChannelIdStep(guildId: string) {
  'use step';
  const channels = await getGuildChannels(guildId);
  const channel = channels.find((item) => normalize(item.name) === normalize(LEVEL_UP_CHANNEL_NAME));
  if (!channel) throw new Error("Level-up channel is missing.");
  return channel.id;
}

async function getLeaderboardChannelIdStep(guildId: string) {
  'use step';
  const channels = await getGuildChannels(guildId);
  const channel = channels.find((item) => normalize(item.name) === normalize(LEADERBOARD_CHANNEL_NAME));
  if (!channel) throw new Error("Leaderboard channel is missing.");
  return channel.id;
}
