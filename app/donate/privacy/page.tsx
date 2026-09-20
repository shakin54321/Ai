export default function DonationPrivacyPage() {
  return (
    <main style={shell}>
      <article style={card}>
        <a href="/donate">← Back to Donation Center</a>
        <p style={eyebrow}>CHITCHAT DONATIONS</p>
        <h1 style={h1}>Privacy Policy</h1>
        <p style={muted}>Last updated: 20 September 2026</p>

        <Section title="1. Who this policy covers">
          This Privacy Policy explains how the CHITCHAT donation website handles
          information submitted through its donation form. It is written for
          this website and does not replace the privacy policies of bKash,
          Nagad, Discord, Vercel, or any other service you may use.
        </Section>

        <Section title="2. Information we collect">
          We ask for a donor name or display name, donation amount, payment
          method, transaction ID/reference, and an optional note. We do not ask
          for a bKash or Nagad PIN, OTP, security code, password, full wallet
          credentials, NID, or card details.
        </Section>

        <Section title="3. Why we use it">
          Donation details are used to identify and review voluntary
          contributions, keep an internal donation log, investigate disputes
          or suspected fraud, and maintain transparent donation records.
        </Section>

        <Section title="4. Where the information goes">
          Submitted donation records are sent to the CHITCHAT Discord donation
          log so authorized server staff can review them. The website does not
          need to store a separate donor database for this workflow.
        </Section>

        <Section title="5. Payment-provider privacy">
          Your actual financial transaction is processed in the bKash or Nagad
          service you use. Their own privacy notices and terms apply to that
          financial transaction. This website is not bKash or Nagad.
        </Section>

        <Section title="6. Data minimization and retention">
          We aim to collect only information needed for donation logging and
          verification. Donation records should be deleted when they are no
          longer reasonably needed for the stated purpose, except where a
          longer period is required for legal, accounting, dispute, fraud, or
          security reasons.
        </Section>

        <Section title="7. Security">
          We use HTTPS through the hosting platform and avoid collecting
          payment credentials. You are responsible for keeping your wallet PIN,
          OTP, passwords, and device secure. Never send those secrets to us.
        </Section>

        <Section title="8. Your choices and requests">
          You may ask the server owner to correct or delete information you
          submitted where appropriate. Requests may be limited where retention
          is necessary for a genuine dispute, fraud investigation, legal
          requirement, or security purpose.
        </Section>

        <Section title="9. Third-party services">
          The website may rely on Vercel for hosting and Discord for the
          donation log. Those services may process technical information
          according to their own policies.
        </Section>

        <Section title="10. Contact">
          For privacy or donation-record requests, contact the CHITCHAT server
          owner through the official CHITCHAT support channel.
        </Section>

        <p style={note}>
          This page is a website-specific privacy notice, not a legal opinion or
          a guarantee of compliance for every possible use. Review with a
          qualified legal professional if this site will operate as a formal
          fundraising business or organization.
        </p>
      </article>
    </main>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <section style={{marginTop:28}}>
      <h2 style={{fontSize:18, margin:"0 0 9px"}}>{title}</h2>
      <p style={{...body, margin:0}}>{children}</p>
    </section>
  );
}

const shell: React.CSSProperties = {
  minHeight:"100vh",
  background:"radial-gradient(circle at top, #27153b 0%, #08080d 46%, #050507 100%)",
  color:"#fff",
  padding:"24px 16px",
  fontFamily:"system-ui, sans-serif",
};
const card: React.CSSProperties = {
  width:"min(860px, 100%)",
  margin:"0 auto",
  padding:"30px",
  borderRadius:28,
  border:"1px solid rgba(255,255,255,.1)",
  background:"rgba(255,255,255,.06)",
  backdropFilter:"blur(22px)",
  boxShadow:"0 30px 80px rgba(0,0,0,.35)",
};
const h1: React.CSSProperties = {fontSize:"clamp(36px, 8vw, 60px)", margin:"8px 0 0", letterSpacing:"-.05em"};
const eyebrow: React.CSSProperties = {color:"rgba(255,255,255,.45)", fontSize:11, letterSpacing:".18em", fontWeight:700, margin:"28px 0 0"};
const muted: React.CSSProperties = {color:"rgba(255,255,255,.42)", fontSize:12};
const body: React.CSSProperties = {color:"rgba(255,255,255,.65)", lineHeight:1.75, fontSize:14};
const note: React.CSSProperties = {marginTop:32, color:"rgba(255,255,255,.4)", fontSize:12, lineHeight:1.65};
