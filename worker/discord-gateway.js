const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
} = require("discord.js");

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const WELCOME_CHANNEL_HINT = "WELCOME";
const MEMBERS_CHANNEL_HINT = "MEMBERS";
const STATUS_CHANNEL_HINT = "STATUSONLINE";

if (!BOT_TOKEN) {
  throw new Error("Missing DISCORD_BOT_TOKEN environment variable.");
}

const DISCORD_API = "https://discord.com/api/v10";

function normalizeChannelName(name = "") {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function findWelcomeChannel(guild) {
  return guild.channels.cache.find((channel) => {
    if (!channel.isTextBased()) return false;
    return normalizeChannelName(channel.name).includes(WELCOME_CHANNEL_HINT);
  });
}

function findMembersCounterChannel(guild) {
  return guild.channels.cache.find((channel) => {
    if (!channel.isTextBased()) return false;
    const normalized = normalizeChannelName(channel.name);
    return normalized.startsWith(MEMBERS_CHANNEL_HINT) && /\d+$/.test(normalized);
  });
}

function findStatusChannel(guild) {
  return guild.channels.cache.find((channel) => {
    if (!channel.isTextBased()) return false;
    const normalized = normalizeChannelName(channel.name);
    return normalized.includes(STATUS_CHANNEL_HINT);
  });
}

async function discordFetch(path, init = {}) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Discord API ${response.status}: ${detail}`);
  }

  return response;
}

async function fetchGuildCounts(guildId) {
  const response = await discordFetch(`/guilds/${guildId}?with_counts=true`);
  return response.json();
}

async function syncGuildStats(guild) {
  const counts = await fetchGuildCounts(guild.id);
  const memberCount =
    typeof counts.approximate_member_count === "number"
      ? counts.approximate_member_count
      : guild.memberCount;

  const membersChannel = findMembersCounterChannel(guild);
  if (membersChannel) {
    const currentName = membersChannel.name || "members-000";
    const nextName = currentName.replace(/\d+$/u, String(memberCount));

    if (nextName !== currentName && membersChannel.manageable) {
      await membersChannel.setName(nextName, "Automatic member counter sync");
    }
  }

  const statusChannel = findStatusChannel(guild);
  if (statusChannel && !statusChannel.name.includes("🟢") && statusChannel.manageable) {
    await statusChannel.setName(
      `${statusChannel.name}🟢`,
      "Keep CHITCHAT online status indicator enabled",
    );
  }

  return {
    memberCount,
    onlineCount:
      typeof counts.approximate_presence_count === "number"
        ? counts.approximate_presence_count
        : null,
  };
}

async function sendWelcome(member, memberCount) {
  const channel = findWelcomeChannel(member.guild);
  if (!channel || !channel.isTextBased() || !channel.sendable) {
    console.warn(
      `[welcome] No usable welcome channel found in ${member.guild.name} (${member.guild.id}).`,
    );
    return;
  }

  const accountTimestamp = Math.floor(member.user.createdTimestamp / 1000);
  const memberNumber = String(memberCount).padStart(3, "0");

  const embed = new EmbedBuilder()
    .setAuthor({
      name: "✦ CHITCHAT",
    })
    .setTitle("WELCOME TO CHITCHAT")
    .setDescription(
      `**${member}** has joined the server.

◈ Member #${memberNumber}
◈ Account created: <t:${accountTimestamp}:R>

Glad to have you here. Please complete verification to unlock the server.`,
    )
    .setThumbnail(member.user.displayAvatarURL({ extension: "png", size: 256 }))
    .setColor(0xa855f7)
    .setFooter({
      text: "CHITCHAT • Welcome",
    });

  await channel.send({ embeds: [embed] });
}

async function handleMemberJoin(member) {
  try {
    const stats = await syncGuildStats(member.guild);
    await sendWelcome(member, stats.memberCount);
    console.log(
      `[join] ${member.user.tag} joined ${member.guild.name}; member #${stats.memberCount}`,
    );
  } catch (error) {
    console.error("[join] Failed to process member join:", error);
  }
}

async function handleMemberRemove(member) {
  try {
    const stats = await syncGuildStats(member.guild);
    console.log(
      `[leave/ban] ${member.user?.tag || member.user?.id || "Unknown user"} removed from ${member.guild.name}; member count ${stats.memberCount}`,
    );
  } catch (error) {
    console.error("[leave/ban] Failed to process member removal:", error);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[gateway] Connected as ${readyClient.user.tag}`);

  for (const guild of readyClient.guilds.cache.values()) {
    try {
      const stats = await syncGuildStats(guild);
      console.log(
        `[ready] ${guild.name}: ${stats.memberCount} members, ${stats.onlineCount ?? "N/A"} online`,
      );
    } catch (error) {
      console.error(`[ready] Failed to sync ${guild.name}:`, error);
    }
  }
});

client.on(Events.GuildMemberAdd, handleMemberJoin);
client.on(Events.GuildMemberRemove, handleMemberRemove);

client.on(Events.Error, (error) => {
  console.error("[gateway] Discord client error:", error);
});

client.on(Events.Warn, (message) => {
  console.warn("[gateway] Discord warning:", message);
});

process.on("SIGTERM", () => {
  console.log("[gateway] Shutting down...");
  client.destroy();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[gateway] Shutting down...");
  client.destroy();
  process.exit(0);
});

client.login(BOT_TOKEN).catch((error) => {
  console.error("[gateway] Login failed:", error);
  process.exit(1);
});
