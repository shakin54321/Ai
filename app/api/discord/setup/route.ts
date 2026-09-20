import { NextRequest, NextResponse } from "next/server";
import { env, registerVerifyCommand } from "@/lib/discord";

export const runtime = "nodejs";

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
    <p>Enter your private setup secret to register the <code>/verify</code> command.</p>
    <form method="post">
      <input
        name="key"
        type="password"
        autocomplete="current-password"
        placeholder="Setup secret"
        required
      />
      <button type="submit">Register /verify</button>
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
    const command = await registerVerifyCommand();
    return setupPage(
      `Success. /verify was registered.

Command ID: ${command.id}
Name: ${command.name}
Application ID: ${env("DISCORD_CLIENT_ID")}`,
      false,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return setupPage(`Registration failed.\n\n${message}`, true);
  }
}

export async function GET(request: NextRequest) {
  const suppliedSecret = request.nextUrl.searchParams.get("key");

  // Keep the old query-key method working for direct links.
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
