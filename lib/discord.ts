import nacl from "tweetnacl";

const DISCORD_API = "https://discord.com/api/v10";
const SEND_MESSAGES_PERMISSION = 1n << 11n;

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKeyHex: string,
): boolean {
  try {
    const message = new TextEncoder().encode(timestamp + body);
    const sig = hexToBytes(signature);
    const publicKey = hexToBytes(publicKeyHex);
    return nacl.sign.detached.verify(message, sig, publicKey);
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function discordFetch(path: string, init: RequestInit = {}) {
  const token = env("DISCORD_BOT_TOKEN");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bot ${token}`);
  headers.set("Content-Type", "application/json");
  return fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

export async function getGuildChannels(guildId: string): Promise<Array<{id:string;name?:string;type:number}>> {
  const res = await discordFetch(`/guilds/${guildId}/channels`);
  if (!res.ok) throw new Error(`Discord channels lookup failed: ${res.status}`);
  return res.json();
}

export async function getGuildRoles(guildId: string): Promise<Array<{id:string;name:string;position:number;managed:boolean}>> {
  const res = await discordFetch(`/guilds/${guildId}/roles`);
  if (!res.ok) throw new Error(`Discord roles lookup failed: ${res.status}`);
  return res.json();
}

export async function getBotUserId(): Promise<string> {
  const res = await discordFetch("/users/@me");
  if (!res.ok) throw new Error(`Discord bot lookup failed: ${res.status}`);
  const user = await res.json();
  return user.id;
}

export async function getGuildMember(guildId: string, userId: string) {
  const res = await discordFetch(`/guilds/${guildId}/members/${userId}`);
  if (!res.ok) throw new Error(`Discord member lookup failed: ${res.status}`);
  return res.json();
}

export async function addRole(guildId: string, userId: string, roleId: string) {
  const res = await discordFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: "PUT",
    body: JSON.stringify({}),
  });
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord add role failed: ${res.status} ${detail}`);
  }
}

export async function removeRole(guildId: string, userId: string, roleId: string) {
  const res = await discordFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord remove role failed: ${res.status} ${detail}`);
  }
}

export async function getBotGuilds() {
  const res = await discordFetch("/users/@me/guilds?limit=200");
  if (!res.ok) throw new Error(`Discord bot guild lookup failed: ${res.status}`);
  return res.json() as Promise<Array<{id:string;name:string}>>;
}

export async function findChitchatGuildId() {
  const guilds = await getBotGuilds();
  const matches = guilds.filter((guild) => guild.name?.trim().toUpperCase() === "CHITCHAT");
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    throw new Error("More than one CHITCHAT server was found.");
  }
  if (guilds.length === 1) return guilds[0].id;
  throw new Error("Could not identify the CHITCHAT server.");
}

export async function getGuildWithCounts(guildId: string) {
  const res = await discordFetch(`/guilds/${guildId}?with_counts=true`);
  if (!res.ok) throw new Error(`Discord guild lookup failed: ${res.status}`);
  return res.json();
}

export async function modifyChannel(
  channelId: string,
  data: Record<string, unknown>,
) {
  const res = await discordFetch(`/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord channel update failed: ${res.status} ${detail}`);
  }
  return res.json();
}

export async function modifyChannelPermission(
  channelId: string,
  overwriteId: string,
  data: {allow: string; deny: string; type: 0 | 1},
) {
  const res = await discordFetch(
    `/channels/${channelId}/permissions/${overwriteId}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Discord channel permission update failed: ${res.status} ${detail}`,
    );
  }
}

export async function modifyRole(
  guildId: string,
  roleId: string,
  data: Record<string, unknown>,
) {
  const res = await discordFetch(`/guilds/${guildId}/roles/${roleId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord role update failed: ${res.status} ${detail}`);
  }
  return res.json();
}

export async function modifyGuild(
  guildId: string,
  data: Record<string, unknown>,
) {
  const res = await discordFetch(`/guilds/${guildId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord guild update failed: ${res.status} ${detail}`);
  }
  return res.json();
}

function normalizeChannelName(name?: string) {
  return (name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isMembersCounterChannel(name?: string) {
  const normalized = normalizeChannelName(name);
  return normalized.startsWith("MEMBERS") && /\d+$/.test(normalized);
}

function isStatusChannel(name?: string) {
  const normalized = normalizeChannelName(name);
  return normalized.includes("STATUS") && normalized.includes("ONLINE");
}

function isWelcomeChannel(name?: string) {
  const normalized = normalizeChannelName(name);
  return normalized.includes("WELCOME");
}

function isAnnouncementChannel(name?: string) {
  const normalized = normalizeChannelName(name);
  return normalized === "ANNOUNCEMENT" || normalized === "SABANNOUNCEMENT";
}

async function configureAnnouncementChannel(
  guildId: string,
  channelId: string,
) {
  const ownerId = process.env.DISCORD_OWNER_ID?.trim();
  const botUserId = await getBotUserId();

  // Type 5 is Discord's News/Announcement channel type.
  await modifyChannel(channelId, {type: 5});

  // Nobody can post by default; the bot and server owner remain able to post.
  await modifyChannelPermission(channelId, guildId, {
    allow: "0",
    deny: SEND_MESSAGES_PERMISSION.toString(),
    type: 0,
  });

  await modifyChannelPermission(channelId, botUserId, {
    allow: SEND_MESSAGES_PERMISSION.toString(),
    deny: "0",
    type: 1,
  });

  if (ownerId) {
    await modifyChannelPermission(channelId, ownerId, {
      allow: SEND_MESSAGES_PERMISSION.toString(),
      deny: "0",
      type: 1,
    });
  }
}

export async function syncGuildStats(guildId: string) {
  const guild = await getGuildWithCounts(guildId);
  const memberCount =
    typeof guild.approximate_member_count === "number"
      ? guild.approximate_member_count
      : null;
  const onlineCount =
    typeof guild.approximate_presence_count === "number"
      ? guild.approximate_presence_count
      : null;

  if (memberCount === null) {
    throw new Error("Discord did not return the member count.");
  }

  const channels = await getGuildChannels(guildId);
  const membersChannel = channels.find((channel) =>
    isMembersCounterChannel(channel.name),
  );
  const statusChannel = channels.find((channel) =>
    isStatusChannel(channel.name),
  );
  const welcomeChannel = channels.find((channel) =>
    isWelcomeChannel(channel.name),
  );
  const announcementChannels = channels.filter((channel) =>
    isAnnouncementChannel(channel.name),
  );

  const protectedRoleNames = new Set([
    "─.✦ 𐔌 ﾟ.✧ Members ✮⋆˙",
    "─.✦ 𐔌 ﾟ.✧ Newbie ✮⋆˙",
    "─.✦ 𐔌 ﾟ.✧ OVERLORD ✮⋆˙",
    "─.✦ 𐔌 ﾟ.✧ Founder ✮⋆˙",
    "─.✦ 𐔌 ﾟ.✧ Developer ✮⋆˙",
    "─.✦ 𐔌 ﾟ.✧ Connections ✮⋆˙",
    "─.✦ 𐔌 ﾟ.✧ Server Booster ✮⋆˙",
    "─.✦ 𐔌 ﾟ.✧ Premium ✮⋆˙",
  ]);

  if (!membersChannel) {
    throw new Error("Members counter channel was not found.");
  }

  const memberName = membersChannel.name ?? "members-000";
  const nextMemberName = memberName.replace(/\d+$/u, String(memberCount));

  const updates: Promise<unknown>[] = [];

  const roles = await getGuildRoles(guildId);
  for (const role of roles) {
    if (role.managed || !protectedRoleNames.has(role.name)) continue;
    updates.push(
      modifyRole(guildId, role.id, {mentionable: false}).catch((error) => {
        console.warn(
          `[discord-roles] could not protect role ${role.name} from mentions:`,
          error,
        );
      }),
    );
  }
  if (nextMemberName !== memberName) {
    updates.push(modifyChannel(membersChannel.id, {name: nextMemberName}));
  }

  // Keep the status channel's requested online indicator intact.
  if (statusChannel && !statusChannel.name?.includes("🟢")) {
    updates.push(
      modifyChannel(statusChannel.id, {
        name: `${statusChannel.name}🟢`,
      }),
    );
  }

  // Let Discord itself post a join notification in the configured welcome channel.
  // This avoids a separate Gateway server while keeping verification untouched.
  if (welcomeChannel) {
    const currentFlags =
      typeof guild.system_channel_flags === "number"
        ? guild.system_channel_flags
        : 0;
    const joinMessagesSuppressed = (currentFlags & 1) !== 0;
    if (
      guild.system_channel_id !== welcomeChannel.id ||
      joinMessagesSuppressed
    ) {
      updates.push(
        modifyGuild(guildId, {
          system_channel_id: welcomeChannel.id,
          system_channel_flags: currentFlags & ~1,
        }).catch((error) => {
          console.warn(
            "[discord-welcome] could not configure Discord system welcome channel:",
            error,
          );
        }),
      );
    }
  }

  // Turn both requested announcement channels into News channels so Discord
  // exposes its native "Follow" option, and lock posting to the owner/bot.
  if (announcementChannels.length) {
    updates.push(
      ...announcementChannels.map((channel) =>
        configureAnnouncementChannel(guildId, channel.id).catch((error) => {
          console.warn(
            `[discord-announcement] could not configure ${channel.name}:`,
            error,
          );
        }),
      ),
    );
  }

  await Promise.all(updates);

  return {
    guildId,
    memberCount,
    onlineCount,
    membersChannelId: membersChannel.id,
    statusChannelId: statusChannel?.id ?? null,
    welcomeChannelId: welcomeChannel?.id ?? null,
    announcementChannelIds: announcementChannels.map((channel) => channel.id),
    membersChannelName: nextMemberName,
    statusChannelName: statusChannel?.name ?? null,
    welcomeChannelName: welcomeChannel?.name ?? null,
    announcementChannelNames: announcementChannels.map((channel) => channel.name ?? ""),
  };
}

export async function registerVerifyCommand() {
  const appId = env("DISCORD_CLIENT_ID");
  const token = env("DISCORD_BOT_TOKEN");
  const body = [
    {
      name: "verify",
      description: "Verify your account and unlock the CHITCHAT server.",
      type: 1,
      dm_permission: false,
    },
    {
      name: "stats",
      description: "Refresh the CHITCHAT member and online stats.",
      type: 1,
      dm_permission: false,
    },
  ];

  const res = await fetch(`${DISCORD_API}/applications/${appId}/commands`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord command registration failed: ${res.status} ${detail}`);
  }
  return res.json();
}

export async function editOriginalInteractionResponse(
  applicationId: string,
  interactionToken: string,
  data: Record<string, unknown>,
) {
  const res = await fetch(
    `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(data),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord interaction edit failed: ${res.status} ${detail}`);
  }
}
