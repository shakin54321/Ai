import { sleep } from "workflow";
import {
  CHITCHAT_STATS_LEASE_PREFIX,
  getGuildChannels,
  syncGuildStats,
} from "@/lib/discord";

async function isStatsLeaseCurrentStep(guildId: string, leaseToken: string) {
  "use step";

  const channels = await getGuildChannels(guildId);
  const membersChannel = channels.find((channel) => {
    const normalized = (channel.name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return normalized.startsWith("MEMBERS") && /\d+$/.test(normalized);
  });

  return (
    (membersChannel?.topic ?? "") ===
    `${CHITCHAT_STATS_LEASE_PREFIX}${leaseToken}`
  );
}

async function syncDiscordStatsStep(guildId: string) {
  "use step";

  return await syncGuildStats(guildId);
}

export async function discordStatsDaemon(
  guildId: string,
  leaseToken: string,
) {
  "use workflow";

  if (!(await isStatsLeaseCurrentStep(guildId, leaseToken))) {
    return;
  }

  while (true) {
    if (!(await isStatsLeaseCurrentStep(guildId, leaseToken))) {
      return;
    }

    try {
      await syncDiscordStatsStep(guildId);
    } catch (error) {
      console.error("[discord-stats] sync failed:", error);
    }

    await sleep("300s");
  }
}
