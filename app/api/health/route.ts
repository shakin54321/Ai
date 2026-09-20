import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'shakin-whatsapp-ai-bridge',
    mode: 'whatsapp-webhook -> make-ai -> whatsapp',
    configured: {
      whatsappAccessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      verifyToken: Boolean(
        process.env.WHATSAPP_VERIFY_TOKEN || 'ShakinWhatsAppVerify_2026',
      ),
      graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v26.0',
    },
  });
}
