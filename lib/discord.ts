import nacl from "tweetnacl";

const DISCORD_API = "https://discord.com/api/v10";

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

  if (!membersChannel) {
    throw new Error("Members counter channel was not found.");
  }

  const memberName = membersChannel.name ?? "members-000";
  const nextMemberName = memberName.replace(/\d+$/u, String(memberCount));

  const updates: Promise<unknown>[] = [];
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

  await Promise.all(updates);

  return {
    guildId,
    memberCount,
    onlineCount,
    membersChannelId: membersChannel.id,
    statusChannelId: statusChannel?.id ?? null,
    membersChannelName: nextMemberName,
    statusChannelName: statusChannel?.name ?? null,
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
      default_member_permissions: "8",
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
