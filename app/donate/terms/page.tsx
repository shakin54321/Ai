export default function DonationTermsPage() {
  return (
    <main style={shell}>
      <article style={card}>
        <a href="/donate">← Back to Donation Center</a>
        <p style={eyebrow}>CHITCHAT DONATIONS</p>
        <h1 style={h1}>Terms & Conditions</h1>
        <p style={muted}>Last updated: 20 September 2026</p>

        <Section title="1. Voluntary donations">
          Donations through this page are voluntary contributions to support
          the CHITCHAT community and its stated activities. A donation does not
          automatically purchase a product, service, rank, role, or guaranteed
          benefit unless a separate written offer expressly says otherwise.
        </Section>

        <Section title="2. Payment methods">
          The site currently displays bKash and Nagad as payment methods to the
          receiving number shown on the page. You must use the official
          bKash/Nagad application or service and follow the instructions shown
          there.
        </Section>

        <Section title="3. No PIN or OTP">
          You must never send your wallet PIN, OTP, security code, password, or
          other authentication secret to CHITCHAT. The donation website does
          not need those credentials.
        </Section>

        <Section title="4. Donation submission">
          After paying, you may submit your donor name, amount, payment method,
          transaction ID/reference, and an optional note. The submission creates
          a pending donation record for review. It is not a payment receipt and
          it is not an automatic confirmation that funds were received.
        </Section>

        <Section title="5. Verification">
          The receiving account owner or authorized staff may compare the
          submitted transaction information with the actual transaction record.
          False, duplicated, altered, or suspicious submissions may be rejected
          and may be reported within the server for moderation or fraud-prevention
          purposes.
        </Section>

        <Section title="6. Refunds">
          Donations are treated as voluntary contributions. Refund requests may
          be considered case-by-case where appropriate, but submitting a form
          does not create an unconditional right to a refund. Payment-provider
          charges, bank/MFS rules, and applicable law may affect how a refund or
          reversal can be handled.
        </Section>

        <Section title="7. Third-party services">
          bKash, Nagad, Discord, Vercel, and other third-party services operate
          under their own terms and policies. CHITCHAT does not control their
          systems and is not responsible for outages, delays, fees, account
          restrictions, or decisions made by those services.
        </Section>

        <Section title="8. Misuse">
          Do not use this page for money laundering, stolen funds, fraudulent
          payment claims, impersonation, harassment, or any other unlawful
          purpose. We may refuse or investigate suspicious submissions.
        </Section>

        <Section title="9. Availability and changes">
          The donation page may be changed, paused, or removed when necessary
          for maintenance, security, compliance, or server operations.
        </Section>

        <Section title="10. Acceptance">
          By using the donation page, you acknowledge that you have read these
          terms and agree to use the service lawfully and honestly.
        </Section>

        <p style={note}>
          These terms are a website-specific template, not a substitute for
          legal advice. If the donation activity becomes formal fundraising,
          commercial activity, or an organized charitable program, obtain local
          legal and accounting advice and ensure the receiving wallet/payment
          arrangement is authorized for that activity.
        </p>
      </article>
    </main>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <section style={{marginTop:28}}>
      <h2 style={{fontSize:18, margin:"0 0 9px"}}>{title}</h2>
      <p style={{color:"rgba(255,255,255,.65)", lineHeight:1.75, fontSize:14, margin:0}}>
        {children}
      </p>
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
const note: React.CSSProperties = {marginTop:32, color:"rgba(255,255,255,.4)", fontSize:12, lineHeight:1.65};
