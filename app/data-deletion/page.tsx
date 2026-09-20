export default function DataDeletionPage() {
  return (
    <main style={{fontFamily:'system-ui,sans-serif',maxWidth:820,margin:'0 auto',padding:'40px 20px',lineHeight:1.7}}>
      <h1>Data Deletion</h1>
      <p><strong>Service:</strong> Shakin WhatsApp AI Bridge</p>

      <p>
        You can request deletion of information associated with your use of the
        Shakin WhatsApp AI Bridge.
      </p>

      <h2>How to request deletion</h2>
      <p>
        From the same WhatsApp account associated with the data, send a message
        to the WhatsApp account using this service and clearly write:
      </p>
      <p><strong>DELETE MY DATA</strong></p>

      <p>
        Include any additional details needed to identify the relevant
        conversation or data. If you cannot contact the service through
        WhatsApp, use the official contact method provided by the service owner.
      </p>

      <h2>What happens next</h2>
      <p>
        We will use the information provided in the request to identify the
        relevant records and delete or de-identify information that is within
        our control, subject to information that must be retained for legal,
        security, fraud-prevention, or technical reasons.
      </p>

      <h2>Third-party services</h2>
      <p>
        Some information may have been processed by third-party services such as
        Meta WhatsApp Business Platform, Telegram, hosting providers, or an AI
        service. Where applicable, deletion requests may also need to be handled
        according to those providers' own procedures and policies.
      </p>

      <p style={{marginTop:40}}>
        <a href="/privacy-policy">Back to Privacy Policy</a>
      </p>
    </main>
  );
}
