import { NextRequest, NextResponse } from "next/server";
import { findChitchatGuildId, sendDonationLog } from "@/lib/discord";

export const runtime = "nodejs";

const recentSubmissions = new Map<string, number>();
const WINDOW_MS = 60_000;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {"Cache-Control": "no-store"},
  });
}

function getClientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const now = Date.now();
  const last = recentSubmissions.get(ip) ?? 0;

  if (now - last < WINDOW_MS) {
    return json(
      {ok: false, message: "Please wait a moment before submitting another donation record."},
      429,
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ok: false, message: "Invalid request."}, 400);
  }

  // Honeypot for simple automated spam.
  if (cleanText(body?.website, 100)) {
    return json({ok: true, submissionId: "ignored"});
  }

  const donorName = cleanText(body?.donorName, 80);
  const method = body?.method === "Nagad" ? "Nagad" : body?.method === "bKash" ? "bKash" : "";
  const transactionId = cleanText(body?.transactionId, 80);
  const note = cleanText(body?.note, 300);
  const rawAmount = Number(body?.amount);

  if (!donorName || donorName.length < 2) {
    return json({ok: false, message: "Please enter a valid donor name."}, 400);
  }
  if (!method) {
    return json({ok: false, message: "Please select bKash or Nagad."}, 400);
  }
  if (!Number.isFinite(rawAmount) || rawAmount < 1 || rawAmount > 1_000_000) {
    return json({ok: false, message: "Donation amount must be between ৳1 and ৳1,000,000."}, 400);
  }
  if (!transactionId || transactionId.length < 4) {
    return json({ok: false, message: "Please enter the transaction ID from your payment receipt."}, 400);
  }

  recentSubmissions.set(ip, now);

  const guildId = process.env.DISCORD_GUILD_ID?.trim() || await findChitchatGuildId();
  const submissionId = `DON-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const submittedAt = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date());

  try {
    await sendDonationLog(guildId, {
      submissionId,
      donorName,
      amount: Math.round(rawAmount * 100) / 100,
      method,
      transactionId,
      note,
      submittedAt,
    });

    return json({
      ok: true,
      submissionId,
      message: "Donation record submitted. It is pending manual verification.",
    });
  } catch (error) {
    recentSubmissions.delete(ip);
    return json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Donation log is temporarily unavailable.",
      },
      503,
    );
  }
}
