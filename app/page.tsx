export default function Home() {
  return (
    <main style={{fontFamily:'system-ui,sans-serif',maxWidth:720,margin:'0 auto',padding:'48px 20px'}}>
      <h1>Shakin WhatsApp AI Bridge</h1>
      <p>Deployment shell is ready.</p>
      <p>Flow: WhatsApp → Telegram log → AI agent → Telegram AI log → WhatsApp reply.</p>
      <p>Webhook: <code>/api/whatsapp</code></p>
      <p>Health: <code>/api/health</code></p>
    </main>
  );
}
