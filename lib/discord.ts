async function discordFetch(path: string, init: RequestInit = {}) {
  const token = env("DISCORD_BOT_TOKEN");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bot ${token}`);
  headers.set("Content-Type", "application/json");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${DISCORD_API}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });

    if (res.status !== 429 || attempt === 2) {
      return res;
    }

    let retryAfterMs = Number(res.headers.get("Retry-After")) * 1000;
    if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
      try {
        const body = await res.clone().json() as {retry_after?: number};
        if (typeof body.retry_after === "number") {
          retryAfterMs = body.retry_after * 1000;
        }
      } catch {
        retryAfterMs = 5000;
      }
    }

    retryAfterMs = Math.min(60000, Math.max(1000, Math.ceil(retryAfterMs || 5000)));
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  }

  throw new Error(`Discord request failed after rate-limit retries: ${path}`);
}

export async function getGuildChannels(guildId: string): Promise<Array<{id:string;name?:string;type:number;topic?:string|null;position?:number;parent_id?:string|null;rate_limit_per_user?:number;nsfw?:boolean;permission_overwrites?:Array<{id:string;type:0|1;allow:string;deny:string}>}>> {
  const res = await discordFetch(`/guilds/${guildId}/channels`);
  if (!res.ok) throw new Error(`Discord channels lookup failed: ${res.status}`);
  return res.json();
}

export async function getGuildRoles(guildId: string): Promise<Array<{id:string;name:string;position:number;managed:boolean;mentionable?:boolean;color?:number}>> {
  const res = await discordFetch(`/guilds/${guildId}/roles`);
  if (!res.ok) throw new Error(`Discord roles lookup failed: ${res.status}`);
  return res.json();
}

export async function createGuildChannel(
  guildId: string,
  data: Record<string, unknown>,
) {
  const res = await discordFetch(`/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord channel creation failed: ${res.status} ${detail}`);
  }
  return res.json() as Promise<{
    id: string;
    name?: string;
    type: number;
    topic?: string | null;
  }>;
}

export async function createGuildRole(
  guildId: string,
  data: {
    name: string;
    color?: number;
    hoist?: boolean;
    mentionable?: boolean;
    permissions?: string;
    reason?: string;
  },
) {
  const auditReason = data.reason?.trim().slice(0, 512);
  const headers = auditReason
    ? {"X-Audit-Log-Reason": encodeURIComponent(auditReason)}
    : undefined;

  const res = await discordFetch(`/guilds/${guildId}/roles`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: data.name,
      color: data.color ?? 0,
      hoist: data.hoist ?? false,
      mentionable: data.mentionable ?? false,
      permissions: data.permissions ?? "0",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord role creation failed: ${res.status} ${detail}`);
  }
  return res.json() as Promise<{
    id: string;
    name: string;
    position: number;
    managed: boolean;
    mentionable?: boolean;
  }>;
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

export async function timeoutGuildMember(
  guildId: string,
  userId: string,
  durationSeconds: number,
  reason: string,
) {
  const minDuration = 60;
  const maxDuration = 28 * 24 * 60 * 60;

  if (!Number.isInteger(durationSeconds) || durationSeconds < minDuration || durationSeconds > maxDuration) {
    throw new Error("Mute duration must be between 1 minute and 28 days.");
  }

  const communicationDisabledUntil = new Date(
    Date.now() + durationSeconds * 1000,
  ).toISOString();

  const auditReason = reason.trim().slice(0, 512);

  const res = await discordFetch(`/guilds/${guildId}/members/${userId}`, {
    method: "PATCH",
    headers: auditReason
      ? {"X-Audit-Log-Reason": encodeURIComponent(auditReason)}
      : undefined,
    body: JSON.stringify({
      communication_disabled_until: communicationDisabledUntil,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord mute failed: ${res.status} ${detail}`);
  }

  return {
    userId,
    communicationDisabledUntil,
  };
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


export async function sendDiscordChannelMessage(
  channelId: string,
  data: Record<string, unknown>,
) {
  const res = await discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord message send failed: ${res.status} ${detail}`);
  }
  return res.json();
}

export async function getDonationLogChannelId(guildId: string): Promise<string | null> {
  const configured = process.env.DISCORD_DONATION_LOG_CHANNEL_ID?.trim();
  if (configured) return configured;

  const channels = await getGuildChannels(guildId);
  const matches = channels.filter((channel) => {
    const normalized = normalizeChannelName(channel.name);
    return normalized.includes("DONATION") && normalized.includes("LOG");
  });

  return matches[0]?.id ?? null;
}

export async function getDiscordChannelMessage(channelId: string, messageId: string) {
  const res = await discordFetch(`/channels/${channelId}/messages/${messageId}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord message lookup failed: ${res.status} ${detail}`);
  }
  return res.json();
}

export async function getDiscordChannelMessages(
  channelId: string,
  options: {limit?: number; after?: string; before?: string} = {},
) {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(100, Math.max(1, options.limit ?? 50))));
  if (options.after) params.set("after", options.after);
  if (options.before) params.set("before", options.before);

  const res = await discordFetch(
    `/channels/${channelId}/messages?${params.toString()}`,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord channel messages lookup failed: ${res.status} ${detail}`);
  }

  return res.json();
}

const AI_CHAT_CHANNEL_NAME = "╌╌✦🤖ai-chat";
const AI_DISABLED_CHANNEL_NAME = "╌✦🤖ai-disabled-legacy";
export const CHITCHAT_AI_LEASE_PREFIX = "CHITCHAT_AI_LEASE:";
export const CHITCHAT_STATS_LEASE_PREFIX = "CHITCHAT_STATS_LEASE:";

function snowflakeSortOldestFirst<T extends {id: string}>(items: T[]) {
  return [...items].sort((a, b) => {
    try {
      return Number(BigInt(a.id) - BigInt(b.id));
    } catch {
      return a.id.localeCompare(b.id);
    }
  });
}

function isAiRelatedChannel(name?: string, topic?: string | null) {
  const normalized = normalizeChannelName(name);

  return (
    normalized === "AICHAT" ||
    normalized.startsWith("AIARCHIVELEGACY") ||
    normalized.startsWith("AIDISABLEDLEGACY") ||
    (typeof topic === "string" && topic.startsWith(CHITCHAT_AI_LEASE_PREFIX))
  );
}

export async function getDiscordChannel(channelId: string) {
  const res = await discordFetch(`/channels/${channelId}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord channel lookup failed: ${res.status} ${detail}`);
  }
  return res.json() as Promise<{
    id: string;
    name?: string;
    type: number;
    topic?: string | null;
    position?: number;
    parent_id?: string | null;
    rate_limit_per_user?: number;
    nsfw?: boolean;
    permission_overwrites?: Array<{
      id: string;
      type: 0 | 1;
      allow: string;
      deny: string;
    }>;
  }>;
}

export async function getChitchatAiChatChannel(
  guildId: string,
): Promise<{id:string;name?:string;type:number;topic?:string|null} | null> {
  const channels = await getGuildChannels(guildId);
  const active = channels
    .filter((channel) => normalizeChannelName(channel.name) === "AICHAT")
    .sort((a, b) => {
      try {
        return Number(BigInt(a.id) - BigInt(b.id));
      } catch {
        return a.id.localeCompare(b.id);
      }
    });

  return active.at(-1) ?? null;
}

async function createChitchatAiChatChannel(
  guildId: string,
  template?: {
    type?: number;
    position?: number;
    parent_id?: string | null;
    rate_limit_per_user?: number;
    nsfw?: boolean;
    permission_overwrites?: Array<{
      id: string;
      type: 0 | 1;
      allow: string;
      deny: string;
    }>;
  },
) {
  const createRes = await discordFetch(`/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name: AI_CHAT_CHANNEL_NAME,
      type: template?.type ?? 0,
      position: template?.position,
      parent_id: template?.parent_id ?? undefined,
      rate_limit_per_user: template?.rate_limit_per_user ?? undefined,
      nsfw: template?.nsfw ?? undefined,
      permission_overwrites: template?.permission_overwrites ?? [],
    }),
  });

  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => "");
    throw new Error(`Discord AI channel creation failed: ${createRes.status} ${detail}`);
  }

  return await createRes.json() as {
    id: string;
    name?: string;
    type: number;
    topic?: string | null;
  };
}

export async function ensureChitchatAiChatChannel(
  guildId: string,
  leaseToken: string,
  statsLeaseToken?: string,
) {
  const channels = await getGuildChannels(guildId);
  const botUserId = await getBotUserId();

  const aiChannels = channels
    .filter((channel) => isAiRelatedChannel(channel.name, channel.topic))
    .sort((a, b) => {
      try {
        return Number(BigInt(a.id) - BigInt(b.id));
      } catch {
        return a.id.localeCompare(b.id);
      }
    });

  const statsMembersChannel = channels.find((channel) =>
    isMembersCounterChannel(channel.name),
  );

  if (statsLeaseToken && statsMembersChannel) {
    await modifyChannel(statsMembersChannel.id, {
      topic: `CHITCHAT_STATS_LEASE:${statsLeaseToken}`,
    });
  }

  // Reuse the newest channel currently named ai-chat. This lets setup
  // recover cleanly when the owner renamed an existing channel manually.
  let active = aiChannels
    .filter((channel) => normalizeChannelName(channel.name) === "AICHAT")
    .at(-1);

  if (!active) {
    const template = aiChannels.at(-1);
    active = await createChitchatAiChatChannel(guildId, template);
  }

  const botChannelPermissions =
    VIEW_CHANNEL_PERMISSION |
    SEND_MESSAGES_PERMISSION |
    READ_MESSAGE_HISTORY_PERMISSION;

  // Restore the bot's access on the active channel even if it previously
  // belonged to an older AI lease.
  await modifyChannelPermission(active.id, botUserId, {
    allow: botChannelPermissions.toString(),
    deny: "0",
    type: 1,
  });

  // Keep exactly one active AI channel. Delete every older AI/legacy channel
  // so repeated setup runs cannot leave a trail of disabled duplicates.
  for (const channel of snowflakeSortOldestFirst(aiChannels)) {
    if (channel.id === active.id) continue;
    await deleteDiscordChannel(channel.id);
  }

  await modifyChannel(active.id, {
    name: AI_CHAT_CHANNEL_NAME,
    topic: `${CHITCHAT_AI_LEASE_PREFIX}${leaseToken}`,
  });

  return await getDiscordChannel(active.id);
}

export async function editDiscordChannelMessage(
  channelId: string,
  messageId: string,
  data: Record<string, unknown>,
) {
  const res = await discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord message update failed: ${res.status} ${detail}`);
  }
  return res.json();
}

export async function sendDonationLog(
  guildId: string,
  data: {
    submissionId: string;
    donorName: string;
    amount: number;
    method: "bKash" | "Nagad";
    transactionId: string;
    note?: string;
    submittedAt: string;
  },
) {
  const channelId = await getDonationLogChannelId(guildId);
  if (!channelId) {
    throw new Error(
      "Donation log channel was not found. Create a channel whose name contains both Donation and Log, or set DISCORD_DONATION_LOG_CHANNEL_ID.",
    );
  }

  return sendDiscordChannelMessage(channelId, {
    embeds: [{
      author: {name: "✦ CHITCHAT DONATIONS"},
      title: "NEW DONATION • PENDING REVIEW",
      description:
        "A donation was submitted through the official donation website. Please verify the transaction in the receiving wallet before treating it as confirmed.",
      color: 0xa855f7,
      fields: [
        {name: "DONOR", value: data.donorName, inline: true},
        {name: "AMOUNT", value: `৳${data.amount.toLocaleString("en-BD")}`, inline: true},
        {name: "METHOD", value: data.method, inline: true},
        {name: "TRANSACTION ID", value: data.transactionId, inline: false},
        {name: "SUBMISSION ID", value: data.submissionId, inline: true},
        {name: "NOTE", value: data.note?.trim() || "No note provided.", inline: true},
      ],
      footer: {text: `CHITCHAT • Donation submitted • ${data.submittedAt}`},
    }],
    allowed_mentions: {parse: []},
  });
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

export async function deleteDiscordChannel(channelId: string) {
  const res = await discordFetch("/channels/" + channelId, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => "");
    throw new Error("Discord channel delete failed: " + res.status + " " + detail);
  }
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

export async function syncGuildStats(guildId: string, statsLeaseToken?: string) {
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

  const updates: Array<() => Promise<unknown>> = [];

  const roles = await getGuildRoles(guildId);
  for (const role of roles) {
    if (
      role.managed ||
      !protectedRoleNames.has(role.name) ||
      role.mentionable === false
    ) {
      continue;
    }

    updates.push(async () => {
      try {
        await modifyRole(guildId, role.id, {mentionable: false});
      } catch (error) {
        console.warn(
          `[discord-roles] could not protect role ${role.name} from mentions:`,
          error,
        );
      }
    });
  }
  if (nextMemberName !== memberName) {
    updates.push(() => modifyChannel(membersChannel.id, {name: nextMemberName}));
  }

  // Keep the status channel's requested online indicator intact.
  if (statusChannel && !statusChannel.name?.includes("🟢")) {
    updates.push(() =>
      modifyChannel(statusChannel.id, {
        name: `${statusChannel.name}🟢`,
      }),
    );
  }

  if (
    statsLeaseToken &&
    (membersChannel.topic ?? "") !== `${CHITCHAT_STATS_LEASE_PREFIX}${statsLeaseToken}`
  ) {
    updates.push(() =>
      modifyChannel(membersChannel.id, {
        topic: `${CHITCHAT_STATS_LEASE_PREFIX}${statsLeaseToken}`,
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
      updates.push(async () => {
        try {
          await modifyGuild(guildId, {
            system_channel_id: welcomeChannel.id,
            system_channel_flags: currentFlags & ~1,
          });
        } catch (error) {
          console.warn(
            "[discord-welcome] could not configure Discord system welcome channel:",
            error,
          );
        }
      });
    }
  }

  // Turn both requested announcement channels into News channels so Discord
  // exposes its native "Follow" option, and lock posting to the owner/bot.
  if (announcementChannels.length) {
    for (const channel of announcementChannels.filter((item) => item.type !== 5)) {
      updates.push(async () => {
        try {
          await configureAnnouncementChannel(guildId, channel.id);
        } catch (error) {
          console.warn(
            `[discord-announcement] could not configure ${channel.name}:`,
            error,
          );
        }
      });
    }
  }

  for (const update of updates) {
    await update();
  }

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
    {
      name: "ai",
      description: "Ask CHITCHAT AI anything.",
      type: 1,
      dm_permission: false,
      options: [
        {
          name: "prompt",
          description: "Your question or message",
          type: 3,
          required: true,
          max_length: 2000,
        },
      ],
    },
    {
      name: "leaderboard",
      description: "View the CHITCHAT XP leaderboard.",
      type: 1,
      dm_permission: false,
    },
    {
      name: "mute",
      description: "Mute a server member for a selected time.",
      type: 1,
      dm_permission: false,
      options: [
        {
          name: "user",
          description: "The server member to mute",
          type: 6,
          required: true,
        },
        {
          name: "time",
          description: "How long the member should be muted",
          type: 3,
          required: true,
          choices: [
            {name: "1 minute", value: "1m"},
            {name: "5 minutes", value: "5m"},
            {name: "10 minutes", value: "10m"},
            {name: "30 minutes", value: "30m"},
            {name: "1 hour", value: "1h"},
            {name: "6 hours", value: "6h"},
            {name: "12 hours", value: "12h"},
            {name: "1 day", value: "1d"},
            {name: "7 days", value: "7d"},
            {name: "28 days", value: "28d"},
          ],
        },
        {
          name: "reason",
          description: "Reason for the mute",
          type: 3,
          required: false,
          max_length: 512,
        },
      ],
    },
    {
      name: "Approved",
      description: "",
      type: 3,
      dm_permission: false,
    },
  ];

  const res = await discordFetch(`/applications/${appId}/commands`, {
    method: "PUT",
    body: JSON.stringify(body),
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
