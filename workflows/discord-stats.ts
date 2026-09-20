import { sleep } from "workflow";
import { syncGuildStats } from "@/lib/discord";

async function syncDiscordStatsStep(guildId: string) {
  "use step";

  return await syncGuildStats(guildId);
}

export async function discordStatsDaemon(guildId: string) {
  "use workflow";

  while (true) {
    try {
      await syncDiscordStatsStep(guildId);
    } catch (error) {
      console.error("[discord-stats] sync failed:", error);
    }

    await sleep("30s");
  }
}
