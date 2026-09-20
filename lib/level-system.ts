import {
  addRole,
  createGuildChannel,
  createGuildRole,
  editDiscordChannelMessage,
  getBotUserId,
  getDiscordChannelMessages,
  getGuildChannels,
  getGuildMember,
  getGuildRoles,
  modifyChannelPermission,
  modifyRole,
  removeRole,
  sendDiscordChannelMessage,
} from "@/lib/discord";

export const LEVEL_UP_CHANNEL_NAME = "╌╌✦📈-level-up";
export const LEADERBOARD_CHANNEL_NAME = "╌╌✦🏆-leaderboard";
export const GET_ROLE_CHANNEL_NAME = "╌╌✦🎭get-role";
export const LEVEL_DATA_CHANNEL_NAME = "╌╌✦🗄️-level-data";
export const LEVEL_ROLE_STYLE = "─.✦ 𐔌 ﾟ.✧ Level ";
export const LEVEL_DATA_PREFIX = "CHITCHAT_LEVEL_DATA:";

export type StoredLevelUser = {
  userId: string;
  xp: number;
  messages: number;
  displayName: string;
  avatar?: string | null;
};

export function levelRoleName(level: number) {
  return `${LEVEL_ROLE_STYLE}${String(level).padStart(2, "0")} ✮⋆˙`;
}

export function xpForLevel(level: number) {
  if (!Number.isInteger(level) || level < 1) return 0;
  return 50 * level * (level + 1);
}

export function levelFromXp(xp: number) {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 0;
  for (let candidate = 1; candidate <= 100; candidate += 1) {
    if (xpForLevel(candidate) <= safeXp) {
      level = candidate;
    } else {
      break;
    }
  }
  return level;
}

function hslToRgb(h: number, s: number, l: number) {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));

  if (sat === 0) {
    const value = Math.round(light * 255);
    return [value, value, value] as const;
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let next = t;
    if (next < 0) next += 1;
    if (next > 1) next -= 1;
    if (next < 1 / 6) return p + (q - p) * 6 * next;
    if (next < 1 / 2) return q;
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
    return p;
  };

  const q = light < 0.5
    ? light * (1 + sat)
    : light + sat - light * sat;
  const p = 2 * light - q;

  return [
    Math.round(hue2rgb(p, q, hue + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hue) * 255),
    Math.round(hue2rgb(p, q, hue - 1 / 3) * 255),
  ] as const;
}

export function levelRoleColor(level: number) {
  const [r, g, b] = hslToRgb((level - 1) * 360 / 100, 0.72, 0.56);
  return (r << 16) | (g << 8) | b;
}

function normalize(name?: string | null) {
  return (name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isTargetChannel(name: string | undefined, target: string) {
  return normalize(name) === normalize(target);
}

export function levelFromRoleName(name?: string | null) {
  if (!name || !name.startsWith(LEVEL_ROLE_STYLE) || !name.endsWith(" ✮⋆˙")) {
    return 0;
  }

  const raw = name.slice(
    LEVEL_ROLE_STYLE.length,
    name.length - " ✮⋆˙".length,
  );
  const level = Number(raw);

  return Number.isInteger(level) && level >= 1 && level <= 100 ? level : 0;
}

export function levelProgress(xp: number) {
  const currentLevel = levelFromXp(xp);
  const currentFloor = currentLevel === 0 ? 0 : xpForLevel(currentLevel);
  const nextFloor = currentLevel < 100 ? xpForLevel(currentLevel + 1) : xpForLevel(100);
  const denominator = Math.max(1, nextFloor - currentFloor);
  const ratio = currentLevel >= 100
    ? 1
    : Math.max(0, Math.min(1, (Math.max(0, xp) - currentFloor) / denominator));

  const width = 12;
  const filled = currentLevel >= 100 ? width : Math.round(ratio * width);
  return {
    currentLevel,
    nextLevel: currentLevel < 100 ? currentLevel + 1 : 100,
    currentFloor,
    nextFloor,
    ratio,
    bar: "█".repeat(filled) + "░".repeat(width - filled),
  };
}

function buildRoleComponents(page: number, roles: Array<{level: number; id: string}>) {
  const pageSize = 20;
  const pageCount = Math.ceil(roles.length / pageSize);
  const start = page * pageSize;
  const visible = roles.slice(start, start + pageSize);
  const rows: any[] = [];

  for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
    const rowRoles = visible.slice(rowIndex * 5, rowIndex * 5 + 5);
    if (!rowRoles.length) break;

    rows.push({
      type: 1,
      components: rowRoles.map((role) => ({
        type: 2,
        style: 2,
        label: `Get LV ${String(role.level).padStart(2, "0")}`,
        custom_id: `chitchat:level-claim:${role.id}`,
      })),
    });
  }

  rows.push({
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        label: "Previous",
        custom_id: `chitchat:level-page:${Math.max(0, page - 1)}`,
        disabled: page <= 0,
      },
      {
        type: 2,
        style: 2,
        label: `Page ${page + 1}/${pageCount}`,
        custom_id: "chitchat:level-page:info",
        disabled: true,
      },
      {
        type: 2,
        style: 2,
        label: "Next",
        custom_id: `chitchat:level-page:${Math.min(pageCount - 1, page + 1)}`,
        disabled: page >= pageCount - 1,
      },
    ],
  });

  return rows;
}

export function buildLevelRolePanel(page: number, roles: Array<{level: number; id: string}>) {
  const pageSize = 20;
  const pageCount = Math.ceil(roles.length / pageSize);
  const start = page * pageSize;
  const visible = roles.slice(start, start + pageSize);

  const description = [
    "**CHITCHAT LEVEL ROLE CENTER**",
    "",
    "Earn XP by chatting in the server. Every **5 valid messages = 10 XP**.",
    "",
    "Each level role uses the same CHITCHAT style with a unique color.",
    "You can claim a role only after reaching its required XP.",
    "",
    `Showing Levels ${start + 1}–${Math.min(start + pageSize, roles.length)} • Page ${page + 1}/${pageCount}`,
    "",
    ...visible.map((role) =>
      `**Level ${String(role.level).padStart(2, "0")}** — ${xpForLevel(role.level).toLocaleString("en-US")} XP • <@&${role.id}>`,
    ),
  ].join("\n");

  return {
    embeds: [{
      title: "LEVEL ROLE CENTER",
      description,
      color: levelRoleColor(Math.max(1, visible[0]?.level ?? 1)),
      footer: {
        text: "CHITCHAT • Level System • Claim only when unlocked",
      },
    }],
    components: buildRoleComponents(page, roles),
  };
}

async function findBotMessage(
  channelId: string,
  botUserId: string,
  title: string,
) {
  const messages = await getDiscordChannelMessages(channelId, {limit: 100}) as Array<any>;
  return messages.find(
    (message) =>
      message.author?.id === botUserId &&
      message.embeds?.[0]?.title === title,
  ) ?? null;
}

async function ensureReadOnlyChannel(guildId: string, channelId: string, botUserId: string) {
  const sendMessagesPermission = (1n << 11n).toString();
  const viewHistorySend = ((1n << 10n) | (1n << 11n) | (1n << 16n)).toString();

  await modifyChannelPermission(channelId, guildId, {
    allow: "0",
    deny: sendMessagesPermission,
    type: 0,
  });

  await modifyChannelPermission(channelId, botUserId, {
    allow: viewHistorySend,
    deny: "0",
    type: 1,
  });
}

async function ensureLevelDataChannel(guildId: string, botUserId: string) {
  const channels = await getGuildChannels(guildId);
  let channel = channels.find((item) => isTargetChannel(item.name, LEVEL_DATA_CHANNEL_NAME));

  if (!channel) {
    const ownerId = process.env.DISCORD_OWNER_ID?.trim();
    const viewHistorySend =
      (1n << 10n) | (1n << 11n) | (1n << 16n);

    const permissionOverwrites: Array<{id: string; type: 0 | 1; allow: string; deny: string}> = [
      {
        id: guildId,
        type: 0,
        allow: "0",
        deny: (1n << 10n).toString(),
      },
      {
        id: botUserId,
        type: 1,
        allow: viewHistorySend.toString(),
        deny: "0",
      },
    ];

    if (ownerId) {
      permissionOverwrites.push({
        id: ownerId,
        type: 1,
        allow: viewHistorySend.toString(),
        deny: "0",
      });
    }

    channel = await createGuildChannel(guildId, {
      name: LEVEL_DATA_CHANNEL_NAME,
      type: 0,
      topic: "CHITCHAT internal level and XP storage. Do not delete.",
      permission_overwrites: permissionOverwrites,
    });
  }

  return channel;
}

export async function setupLevelSystem(guildId: string) {
  const botUserId = await getBotUserId();
  const channels = await getGuildChannels(guildId);

  const levelUpChannel = channels.find((channel) =>
    isTargetChannel(channel.name, LEVEL_UP_CHANNEL_NAME),
  );
  const leaderboardChannel = channels.find((channel) =>
    isTargetChannel(channel.name, LEADERBOARD_CHANNEL_NAME),
  );
  const getRoleChannel = channels.find((channel) =>
    isTargetChannel(channel.name, GET_ROLE_CHANNEL_NAME),
  );

  if (!levelUpChannel || !leaderboardChannel || !getRoleChannel) {
    throw new Error(
      "Level system channels not found. Create ╌╌✦📈-level-up, ╌╌✦🏆-leaderboard, and ╌╌✦🎭get-role first.",
    );
  }

  await ensureReadOnlyChannel(guildId, levelUpChannel.id, botUserId);
  await ensureReadOnlyChannel(guildId, leaderboardChannel.id, botUserId);
  await ensureReadOnlyChannel(guildId, getRoleChannel.id, botUserId);

  const dataChannel = await ensureLevelDataChannel(guildId, botUserId);
  const roles = await getGuildRoles(guildId);

  const levelRoles: Array<{level: number; id: string}> = [];
  for (let level = 1; level <= 100; level += 1) {
    const name = levelRoleName(level);
    const existing = roles.find((role) => role.name === name);

    const role = existing
      ? await modifyRole(guildId, existing.id, {
          name,
          color: levelRoleColor(level),
          hoist: false,
          mentionable: false,
          permissions: "0",
        })
      : await createGuildRole(guildId, {
          name,
          color: levelRoleColor(level),
          hoist: false,
          mentionable: false,
          permissions: "0",
          reason: `CHITCHAT level role setup • Level ${level}`,
        });

    levelRoles.push({level, id: role.id});
  }

  const getRoleMessage = await findBotMessage(getRoleChannel.id, botUserId, "LEVEL ROLE CENTER");
  const rolePanel = buildLevelRolePanel(0, levelRoles);
  if (getRoleMessage?.id) {
    await editDiscordChannelMessage(getRoleChannel.id, getRoleMessage.id, rolePanel);
  } else {
    await sendDiscordChannelMessage(getRoleChannel.id, rolePanel);
  }

  const leaderboardMessage = await findBotMessage(
    leaderboardChannel.id,
    botUserId,
    "LIVE LEADERBOARD",
  );

  if (!leaderboardMessage) {
    await sendDiscordChannelMessage(leaderboardChannel.id, {
      embeds: [{
        title: "LIVE LEADERBOARD",
        description: "No XP has been earned yet. Start chatting to appear here.",
        color: 0xa855f7,
        footer: {text: "CHITCHAT • XP Leaderboard"},
      }],
    });
  }

  return {
    levelUpChannelId: levelUpChannel.id,
    leaderboardChannelId: leaderboardChannel.id,
    getRoleChannelId: getRoleChannel.id,
    levelDataChannelId: dataChannel.id,
    levelRoleCount: levelRoles.length,
  };
}

export async function readLevelStore(guildId: string, dataChannelId?: string) {
  const botUserId = await getBotUserId();
  const channels = await getGuildChannels(guildId);
  const dataChannel = dataChannelId
    ? channels.find((channel) => channel.id === dataChannelId)
    : channels.find((channel) => isTargetChannel(channel.name, LEVEL_DATA_CHANNEL_NAME));

  if (!dataChannel) {
    return {
      users: new Map<string, StoredLevelUser>(),
      messageIds: new Map<string, string>(),
      dataChannelId: null as string | null,
    };
  }

  const allMessages: Array<any> = [];
  let before: string | undefined;

  for (let page = 0; page < 50; page += 1) {
    const batch = await getDiscordChannelMessages(dataChannel.id, {
      limit: 100,
      before,
    }) as Array<any>;

    if (!batch.length) break;
    allMessages.push(...batch);
    before = batch.at(-1)?.id;
    if (batch.length < 100) break;
  }

  const users = new Map<string, StoredLevelUser>();
  const messageIds = new Map<string, string>();
  for (const message of allMessages) {
    if (message.author?.id !== botUserId || typeof message.content !== "string") continue;
    if (!message.content.startsWith(LEVEL_DATA_PREFIX)) continue;

    try {
      const record = JSON.parse(message.content.slice(LEVEL_DATA_PREFIX.length));
      if (
        typeof record?.userId === "string" &&
        Number.isFinite(record?.xp) &&
        Number.isFinite(record?.messages)
      ) {
        users.set(record.userId, {
          userId: record.userId,
          xp: Math.max(0, Math.floor(record.xp)),
          messages: Math.max(0, Math.floor(record.messages)),
          displayName: typeof record.displayName === "string" ? record.displayName : "Member",
          avatar: typeof record.avatar === "string" ? record.avatar : null,
        });
        if (typeof message.id === "string") {
          messageIds.set(record.userId, message.id);
        }
      }
    } catch {
      // Ignore malformed internal storage messages.
    }
  }

  return {
    users,
    messageIds,
    dataChannelId: dataChannel.id,
  };
}
