import { sleep } from "workflow";
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
  levelRoleColor,
  type StoredLevelUser,
} from "@/lib/level-system";
import {
  editDiscordChannelMessage,
  getBotUserId,
  getDiscordChannelMessages,
  getGuildChannels,
  getGuildRoles,
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

function avatarUrl(userId: string, avatar?: string | null) {
  if (!avatar) return null;
  const extension = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${extension}?size=256`;
}

async function bootstrapStep(guildId: string) {
  "use step";

  await setupLevelSystem(guildId);

  const channels = await getGuildChannels(guildId);
  const dataChannel = channels.find(
    (channel) => normalize(channel.name) === normalize(LEVEL_DATA_CHANNEL_NAME),
  );

  if (!dataChannel) {
    throw new Error("Level data channel is missing. Run the setup page again.");
  }

  const stored = await readLevelStore(guildId, dataChannel.id);

  const cursors: Record<string, string> = {};
  for (const channel of channels.filter(isCountableChannel)) {
    const messages = await getDiscordChannelMessages(channel.id, {limit: 1}) as DiscordMessage[];
    cursors[channel.id] = messages[0]?.id ?? "";
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
  "use step";

  const channels = await getGuildChannels(guildId);
  const nextCursors = {...cursors};
  const newMessages: Array<DiscordMessage & {channelName?: string}> = [];

  for (const channel of channels.filter(isCountableChannel)) {
    const previous = cursors[channel.id] || undefined;
    let cursor = previous;
    let fetched = 0;

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
  "use step";

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
      // Recreate the record if it was removed manually.
    }
  }

  const created = await sendDiscordChannelMessage(dataChannelId, {
    content,
    allowed_mentions: {parse: []},
  });

  return created.id as string;
}

async function getLevelRoleStep(guildId: string, level: number) {
  "use step";

  const roles = await getGuildRoles(guildId);
  const role = roles.find((item) => item.name === levelRoleName(level));

  if (!role) {
    throw new Error(`Level role for Level ${level} is missing. Run the setup page again.`);
  }

  return role;
}

async function sendLevelUpStep(
  guildId: string,
  channelId: string,
  user: StoredLevelUser,
  newLevel: number,
) {
  "use step";

  const role = await getLevelRoleStep(guildId, newLevel);

  await sendDiscordChannelMessage(channelId, {
    content: `<@${user.userId}>`,
    embeds: [{
      title: "LEVEL UP",
      description: [
        `You reached **Level ${newLevel}**.`,
        "",
        `Required XP: **${xpForLevel(newLevel).toLocaleString("en-US")} XP**`,
        `Unlocked role: <@&${role.id}>`,
        "",
        "Go to the level role center and claim your unlocked role.",
      ].join("\n"),
      color: role.color ?? 0xa855f7,
      footer: {text: "CHITCHAT • Level System"},
    }],
    allowed_mentions: {users: [user.userId]},
  });
}

async function findLeaderboardMessageStep(
  channelId: string,
  botUserId: string,
) {
  "use step";

  const messages = await getDiscordChannelMessages(channelId, {limit: 100}) as Array<any>;

  return messages.find(
    (message) =>
      message.author?.id === botUserId &&
      message.embeds?.[0]?.title === "LIVE LEADERBOARD",
  )?.id ?? null;
}

async function updateLeaderboardStep(
  channelId: string,
  messageId: string | undefined,
  users: StoredLevelUser[],
  botUserId: string,
) {
  "use step";

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
    } catch {
      // Re-discover the message below.
    }
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
  guildId: string,
  channelId: string,
  messageId: string,
  userId: string,
  users: Record<string, StoredLevelUser>,
) {
  "use step";

  const current = users[userId] ?? {
    userId,
    xp: 0,
    messages: 0,
    displayName: "Member",
    avatar: null,
  };

  const sorted = Object.values(users).sort(
    (a, b) =>
      b.xp - a.xp ||
      b.messages - a.messages ||
      a.userId.localeCompare(b.userId),
  );
  const rankIndex = sorted.findIndex((user) => user.userId === userId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : sorted.length + 1;
  const progress = makeProgress(current.xp);

  let profileAvatar = current.avatar ?? null;

  if (!profileAvatar) {
    try {
      const channels = await getGuildChannels(guildId);
      void channels;
      // Member lookup is intentionally avoided here when cached message
      // author data already exists; the next normal message updates avatar data.
    } catch {}
  }

  const description = [
    `**Level ${progress.currentLevel}**`,
    `XP: **${current.xp.toLocaleString("en-US")} / ${progress.nextFloor.toLocaleString("en-US")}**`,
    `Server Rank: **#${rank}**`,
    `Messages: **${current.messages.toLocaleString("en-US")}**`,
    "",
    progress.bar,
  ].join("\n");

  const thumbnailUrl = profileAvatar
    ? avatarUrl(userId, profileAvatar)
    : null;

  await sendDiscordChannelMessage(channelId, {
    content: `<@${userId}>`,
    embeds: [{
      title: current.displayName,
      description,
      color: 0xa855f7,
      thumbnail: thumbnailUrl ? {url: thumbnailUrl} : undefined,
      footer: {text: "CHITCHAT • !rank"},
    }],
    message_reference: {message_id: messageId},
    allowed_mentions: {users: [userId]},
  });
}

export async function discordLevelDaemon(guildId: string) {
  "use workflow";

  let state = await bootstrapStep(guildId);

  while (true) {
    const result = await fetchNewMessagesStep(guildId, state.cursors);
    state.cursors = result.nextCursors;

    for (const message of result.newMessages) {
      const userId = message.author?.id;
      if (!userId || message.author?.bot) continue;

      const content =
        typeof message.content === "string" ? message.content.trim() : "";
      if (!content) continue;

      const existing = state.users[userId] ?? {
        userId,
        xp: 0,
        messages: 0,
        displayName:
          message.author?.global_name ||
          message.author?.username ||
          "Member",
        avatar: null,
      };

      existing.displayName =
        message.author?.global_name ||
        message.author?.username ||
        existing.displayName;

      const freshAvatar = avatarUrl(
        userId,
        message.author?.avatar,
      );
      if (freshAvatar) {
        existing.avatar = freshAvatar;
      }

      // !rank is a utility command, not an XP-bearing message.
      if (content.toLowerCase() === "!rank") {
        await sendRankStep(
          guildId,
          message.channel_id ?? "",
          message.id,
          userId,
          state.users,
        );
        continue;
      }

      existing.messages += 1;
      state.users[userId] = existing;

      // Exactly 5 valid messages = 10 XP.
      if (existing.messages % 5 !== 0) continue;

      const previousXp = existing.xp;
      existing.xp += 10;

      state.dataMessageIds[userId] = await persistUserStep(
        state.dataChannelId,
        existing,
        state.dataMessageIds[userId],
      );

      const previousLevel = levelFromXp(previousXp);
      const newLevel = levelFromXp(existing.xp);

      if (newLevel > previousLevel) {
        const channels = await getGuildChannelsStep(guildId);
        const levelUpChannel = channels.find(
          (item) => normalize(item.name) === normalize(LEVEL_UP_CHANNEL_NAME),
        );

        if (levelUpChannel) {
          await sendLevelUpStep(
            guildId,
            levelUpChannel.id,
            existing,
            newLevel,
          );
        }
      }
    }

    state.tick += 1;

    if (state.tick % 6 === 0) {
      const channels = await getGuildChannelsStep(guildId);
      const leaderboardChannel = channels.find(
        (item) =>
          normalize(item.name) === normalize(LEADERBOARD_CHANNEL_NAME),
      );

      if (leaderboardChannel) {
        state.leaderboardMessageId = await updateLeaderboardStep(
          leaderboardChannel.id,
          state.leaderboardMessageId,
          Object.values(state.users),
          await getBotUserIdStep(),
        );
      }
    }

    await sleep("5s");
  }
}

async function getGuildChannelsStep(guildId: string) {
  "use step";
  return await getGuildChannels(guildId);
}

async function getBotUserIdStep() {
  "use step";
  return await getBotUserId();
}
