import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { getWorld } from "workflow/runtime";
import {
  env,
  findChitchatGuildId,
  ensureChitchatAiChatChannel,
  registerVerifyCommand,
  syncGuildStats,
} from "@/lib/discord";
import { discordStatsDaemon } from "@/workflows/discord-stats";
import { chitchatAiDaemon } from "@/workflows/discord-ai";

export const runtime = "nodejs";

async function cancelActiveChitchatAiRuns() {
  const world = await getWorld();
  let cancelled = 0;

  for (const status of ["pending", "running"] as const) {
    let cursor: string | undefined;

    do {
      const page = await world.runs.list({
        status,
        pagination: {
          limit: 100,
          ...(cursor ? {cursor} : {}),
        },
        resolveData: "none",
      });

      for (const run of page.data) {
        const workflowName = typeof run.workflowName === "string"
          ? run.workflowName
          : "";

        if (
          !workflowName.includes("chitchatAiDaemon") &&
          !workflowName.includes("discord-ai")
        ) {
          continue;
        }

        try {
          await world.events.create(run.runId, {
            eventType: "run_cancelled",
          });
          cancelled += 1;
        } catch (error) {
          console.warn(
            `[chitchat-ai] could not cancel stale run ${run.runId}:`,
            error,
          );
        }
      }

      cursor = page.hasMore && page.cursor ? page.cursor : undefined;
    } while (cursor);
  }

  return cancelled;
}

function setupPage(message = "", isError = false) {
  const safeMessage = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  return new NextResponse(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CHITCHAT AI Setup</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top, #2b183d 0, #09090d 45%, #050507 100%);
      color: #fff;
    }
    .card {
      width: min(100%, 430px);
      padding: 28px;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 24px;
      background: rgba(255,255,255,.07);
      backdrop-filter: blur(18px);
      box-shadow: 0 20px 70px rgba(0,0,0,.45);
    }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { color: rgba(255,255,255,.7); line-height: 1.5; }
    input {
      width: 100%;
      padding: 14px 15px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(0,0,0,.24);
      color: #fff;
      outline: none;
    }
    button {
      width: 100%;
      margin-top: 12px;
      padding: 14px;
      border: 0;
      border-radius: 14px;
      background: #fff;
      color: #111;
      font-weight: 700;
      cursor: pointer;
    }
    .msg {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 12px;
      background: ${isError ? "rgba(255,85,85,.14)" : "rgba(85,255,150,.12)"};
      color: ${isError ? "#ffb2b2" : "#b9ffd2"};
      white-space: pre-wrap;
    }
    .hint { font-size: 13px; margin-top: 12px; }
  </style>
</head>
<body>
  <main class="card">
    <h1>CHITCHAT AI Setup</h1>
    <p>Enter your private setup secret to register <code>/verify</code>, <code>/stats</code>, <code>/ai</code>, the donation <code>Approved</code> message action, and start CHITCHAT AI automation.</p>
    <form method="post">
      <input
        name="key"
        type="password"
        autocomplete="current-password"
        placeholder="Setup secret"
        required
      />
      <button type="submit">Register / Start Automation</button>
    </form>
    ${safeMessage ? `<div class="msg">${safeMessage}</div>` : ""}
    <p class="hint">Your setup secret is only used to authorize this setup action. Never share it in chat.</p>
  </main>
</body>
</html>`,
    {
      status: isError ? 401 : 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

async function registerWithSecret(suppliedSecret: string | null) {
  const configuredSecret = process.env.DISCORD_SETUP_SECRET;

  if (configuredSecret && suppliedSecret !== configuredSecret) {
    return setupPage("Invalid setup key.", true);
  }

  try {
    const registered = await registerVerifyCommand();
    const commands = Array.isArray(registered) ? registered : [registered];
    const commandNames = commands
      .map((item: any) => (item?.name ? `/${item.name}` : null))
      .filter(Boolean)
      .join(", ");

    const guildId = await findChitchatGuildId();

    // Hard-stop every previously running CHITCHAT AI daemon before creating
    // the replacement. This targets the durable workflow runs themselves,
    // so stale executions cannot keep replying after a redeploy/channel swap.
    const cancelledAiRuns = await cancelActiveChitchatAiRuns();

    // Apply the latest Discord channel configuration immediately.
    // This also keeps the existing stats/welcome/verification behavior intact.
    const synced = await syncGuildStats(guildId);

    // Give this AI daemon a unique lease. The helper creates a fresh active
    // channel whenever the current channel was owned by an older daemon.
    const aiLeaseToken = crypto.randomUUID();
    const aiChannel = await ensureChitchatAiChatChannel(guildId, aiLeaseToken);

    if (!aiChannel) {
      throw new Error("The ╌✦🤖ai-chat channel could not be prepared.");
    }

    const statsRun = await start(discordStatsDaemon, [guildId]);
    const aiRun = await start(chitchatAiDaemon, [guildId, aiLeaseToken]);

    const announcementStatus = synced.announcementChannelIds?.length
      ? `Announcement channels configured: ${synced.announcementChannelNames.join(", ")}`
      : "Announcement channels not found.";

    return setupPage(
      `Success. /verify, /stats, /ai, and Approved were registered.

Registered commands: ${commandNames || "/verify, /stats, /ai"}
Application ID: ${env("DISCORD_CLIENT_ID")}
Guild ID: ${guildId}
AI Automation: ACTIVE
AI Channel: ${aiChannel.name ?? "╌✦🤖ai-chat"}
Stale AI Workflows Cancelled: ${cancelledAiRuns}
Stats Workflow Run: ${statsRun.runId}
AI Workflow Run: ${aiRun.runId}

${announcementStatus}
Existing member count and online status automation remains active and continues syncing every 60 seconds.`,
      false,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return setupPage(`Registration failed.\n\n${message}`, true);
  }
}

export async function GET(request: NextRequest) {
  const suppliedSecret = request.nextUrl.searchParams.get("key");

  if (suppliedSecret !== null) {
    return registerWithSecret(suppliedSecret);
  }

  return setupPage();
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const suppliedSecret = formData.get("key");

  return registerWithSecret(
    typeof suppliedSecret === "string" ? suppliedSecret : null,
  );
}
