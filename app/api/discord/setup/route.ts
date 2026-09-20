import { NextRequest, NextResponse } from "next/server";
import { env, registerVerifyCommand } from "@/lib/discord";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const configuredSecret = process.env.DISCORD_SETUP_SECRET;
  const suppliedSecret = request.nextUrl.searchParams.get("key");

  if (configuredSecret && suppliedSecret !== configuredSecret) {
    return NextResponse.json({ok:false,error:"Invalid setup key"}, {status:401});
  }

  try {
    const command = await registerVerifyCommand();
    return NextResponse.json({
      ok:true,
      message:"/verify command registered successfully.",
      commandId: command.id,
      name: command.name,
      applicationId: env("DISCORD_CLIENT_ID"),
    });
  } catch (error) {
    return NextResponse.json({
      ok:false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, {status:500});
  }
}
