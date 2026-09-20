import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok:true,
    service:"CHITCHAT AI Discord verification",
    endpoints:{
      interactions:"/api/discord/interactions",
      setup:"/api/discord/setup",
    },
  });
}
