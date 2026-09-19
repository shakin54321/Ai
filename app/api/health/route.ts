import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'shakin-whatsapp-ai-bridge',
    configured: {
      whatsapp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      ai: Boolean(process.env.OPENAI_API_KEY),
      verifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    },
  });
}
