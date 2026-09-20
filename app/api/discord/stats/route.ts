import { NextRequest, NextResponse } from "next/server";
import { env, findChitchatGuildId, syncGuildStats } from "@/lib/discord";

export const runtime = "nodejs";
export const maxDuration = 15;

function isAuthorized(request: NextRequest) {
  const expected = process.env.DISCORD_SETUP_SECRET;
  if (!expected) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${expected}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const guildId =
      request.nextUrl.searchParams.get("guild_id") || (await findChitchatGuildId());
    const result = await syncGuildStats(guildId);

    return NextResponse.json({
      ok: true,
      ...result,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
