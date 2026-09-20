"use client";

import { FormEvent, useMemo, useState } from "react";

type PaymentMethod = "bKash" | "Nagad";

const RECEIVING_NUMBER = "01768780058";

export default function DonatePage() {
  const [method, setMethod] = useState<PaymentMethod>("bKash");
  const [donorName, setDonorName] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [submissionId, setSubmissionId] = useState("");

  const methodLabel = useMemo(
    () => (method === "bKash" ? "bKash" : "Nagad"),
    [method],
  );

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(RECEIVING_NUMBER);
      setMessage("Number copied.");
      setStatus("success");
      window.setTimeout(() => {
        setStatus("idle");
        setMessage("");
      }, 1400);
    } catch {
      setStatus("error");
      setMessage("Copy failed. Please copy the number manually.");
    }
  }

  async function submitDonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");
    setSubmissionId("");

    try {
      const response = await fetch("/api/donations", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          donorName,
          amount,
          method,
          transactionId,
          note,
          website,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        throw new Error(data.message || "Could not submit the donation record.");
      }

      setStatus("success");
      setMessage(data.message || "Donation submitted.");
      setSubmissionId(data.submissionId || "");
      setDonorName("");
      setAmount("");
      setTransactionId("");
      setNote("");
      setWebsite("");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  return (
    <main className="donation-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <a className="brand" href="/donate" aria-label="CHITCHAT Donations">
          <span className="brand-mark">✦</span>
          <span>
            <strong>CHITCHAT</strong>
            <small>Donation Center</small>
          </span>
        </a>
        <nav>
          <a href="#how-it-works">How it works</a>
          <a href="/donate/privacy">Privacy</a>
          <a href="/donate/terms">Terms</a>
        </nav>
      </header>

      <section className="hero glass">
        <div>
          <p className="eyebrow">✦ COMMUNITY SUPPORT</p>
          <h1>Support CHITCHAT.</h1>
          <p className="hero-copy">
            Your voluntary contribution helps support the community, server
            services, development, moderation, and future improvements.
          </p>
        </div>
        <div className="hero-orb">
          <span>৳</span>
        </div>
      </section>

      <section className="grid">
        <article className="card glass">
          <div className="section-head">
            <span className="index">01</span>
            <div>
              <p className="eyebrow">PAYMENT METHOD</p>
              <h2>Choose how you want to donate</h2>
            </div>
          </div>

          <div className="method-grid">
            {(["bKash", "Nagad"] as PaymentMethod[]).map((item) => (
              <button
                key={item}
                type="button"
                className={method === item ? "method active" : "method"}
                onClick={() => setMethod(item)}
              >
                <span>{item}</span>
                <small>{item === "bKash" ? "Mobile financial service" : "Mobile financial service"}</small>
              </button>
            ))}
          </div>

          <div className="number-card">
            <div>
              <span className="label">SEND TO</span>
              <strong>{RECEIVING_NUMBER}</strong>
              <small>{methodLabel} receiving number</small>
            </div>
            <button type="button" onClick={copyNumber} className="copy-button">
              Copy
            </button>
          </div>

          <div className="notice">
            <strong>Security</strong>
            <p>
              Never enter your bKash/Nagad PIN, OTP, security code, password,
              or full wallet credentials on this website. We only ask for the
              payment reference needed to identify your submitted donation.
            </p>
          </div>

          <div className="instructions">
            <div>
              <span>1</span>
              <p>Open your {methodLabel} app and send the amount to the number above using the transaction type available for the receiving account.</p>
            </div>
            <div>
              <span>2</span>
              <p>Complete the transaction normally in the official app.</p>
            </div>
            <div>
              <span>3</span>
              <p>Copy the transaction ID/reference from the receipt and submit it below.</p>
            </div>
          </div>
        </article>

        <article className="card glass">
          <div className="section-head">
            <span className="index">02</span>
            <div>
              <p className="eyebrow">DONATION RECORD</p>
              <h2>Tell us about your payment</h2>
            </div>
          </div>

          <form onSubmit={submitDonation} className="donation-form">
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              name="website"
              autoComplete="off"
              tabIndex={-1}
              className="honeypot"
              aria-hidden="true"
            />

            <label>
              Donor name / display name
              <input
                value={donorName}
                onChange={(e) => setDonorName(e.target.value)}
                placeholder="Your name"
                maxLength={80}
                required
              />
            </label>

            <div className="two">
              <label>
                Amount (BDT)
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  type="number"
                  min="1"
                  max="1000000"
                  step="0.01"
                  placeholder="500"
                  required
                />
              </label>

              <label>
                Method
                <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  <option>bKash</option>
                  <option>Nagad</option>
                </select>
              </label>
            </div>

            <label>
              Transaction ID / reference
              <input
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                placeholder="Enter the ID from your receipt"
                maxLength={80}
                required
              />
            </label>

            <label>
              Note <span className="optional">optional</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="A short message for the team"
                maxLength={300}
                rows={4}
              />
            </label>

            <button className="submit-button" disabled={status === "loading"}>
              {status === "loading" ? "Submitting…" : "Submit Donation Record"}
            </button>
          </form>

          {message ? (
            <div className={status === "error" ? "form-status error" : "form-status"}>
              <strong>{status === "error" ? "Not submitted" : "Done"}</strong>
              <p>{message}</p>
              {submissionId ? <small>Submission ID: {submissionId}</small> : null}
            </div>
          ) : null}

          <p className="verification-note">
            Submission creates a <strong>pending</strong> donation record in the
            CHITCHAT donation log. It does not automatically prove that the
            payment was received.
          </p>
        </article>
      </section>

      <section id="how-it-works" className="how glass">
        <div>
          <p className="eyebrow">03 — TRANSPARENT FLOW</p>
          <h2>Payment → record → manual verification</h2>
        </div>
        <div className="flow">
          <div><span>01</span><strong>Pay</strong><p>Use the official bKash/Nagad app.</p></div>
          <div><span>02</span><strong>Submit</strong><p>Enter only your donation details and transaction ID.</p></div>
          <div><span>03</span><strong>Review</strong><p>The team checks the transaction before treating it as confirmed.</p></div>
        </div>
      </section>

      <footer className="footer">
        <span>CHITCHAT Donations</span>
        <span>
          <a href="/donate/privacy">Privacy Policy</a>
          <a href="/donate/terms">Terms & Conditions</a>
        </span>
      </footer>

      <style jsx global>{`
        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #f7f4ff;
          background: #07070b;
        }
        button, input, select, textarea { font: inherit; }
        a { color: inherit; text-decoration: none; }
        .donation-shell {
          min-height: 100vh;
          position: relative;
          overflow: hidden;
          padding: 20px;
          background:
            radial-gradient(circle at 12% 0%, rgba(255, 104, 193, .14), transparent 28%),
            radial-gradient(circle at 88% 14%, rgba(117, 95, 255, .18), transparent 30%),
            linear-gradient(145deg, #08080c, #101017 48%, #08080b);
        }
        .ambient {
          position: fixed;
          width: 260px;
          height: 260px;
          border-radius: 50%;
          filter: blur(80px);
          opacity: .45;
          pointer-events: none;
          animation: float 10s ease-in-out infinite alternate;
        }
        .ambient-one { background: rgba(255, 64, 170, .3); top: 18%; left: -80px; }
        .ambient-two { background: rgba(103, 91, 255, .28); right: -90px; bottom: 8%; animation-delay: -3s; }
        @keyframes float { to { transform: translate3d(0, 22px, 0) scale(1.05); } }
        .topbar, .hero, .grid, .how, .footer { width: min(1120px, 100%); margin-inline: auto; }
        .topbar {
          display:flex; align-items:center; justify-content:space-between;
          gap:20px; padding:10px 2px 28px;
        }
        .brand { display:flex; align-items:center; gap:11px; }
        .brand-mark {
          width:40px; height:40px; display:grid; place-items:center; border-radius:13px;
          background: linear-gradient(135deg, rgba(255,255,255,.17), rgba(255,255,255,.05));
          border:1px solid rgba(255,255,255,.11);
          box-shadow:0 10px 30px rgba(0,0,0,.2);
        }
        .brand strong, .brand small { display:block; }
        .brand strong { letter-spacing:.18em; font-size:13px; }
        .brand small { margin-top:4px; color:rgba(255,255,255,.48); font-size:11px; }
        nav { display:flex; gap:18px; color:rgba(255,255,255,.62); font-size:13px; }
        nav a:hover, .footer a:hover { color:#fff; }
        .glass {
          border:1px solid rgba(255,255,255,.1);
          background:linear-gradient(145deg, rgba(255,255,255,.09), rgba(255,255,255,.035));
          backdrop-filter: blur(24px);
          box-shadow:0 30px 80px rgba(0,0,0,.28);
        }
        .hero {
          min-height:270px; padding:38px; border-radius:32px; display:flex;
          align-items:center; justify-content:space-between; gap:28px;
        }
        .eyebrow { margin:0 0 8px; color:rgba(255,255,255,.48); font-size:11px; letter-spacing:.2em; font-weight:700; }
        h1 { margin:0; font-size:clamp(42px, 8vw, 76px); line-height:.94; letter-spacing:-.05em; }
        h2 { margin:0; font-size:24px; letter-spacing:-.03em; }
        .hero-copy { max-width:640px; color:rgba(255,255,255,.66); line-height:1.75; font-size:15px; margin:18px 0 0; }
        .hero-orb {
          flex:0 0 145px; width:145px; height:145px; display:grid; place-items:center; border-radius:45px;
          background:radial-gradient(circle at 35% 25%, rgba(255,255,255,.28), rgba(255,255,255,.04) 42%), linear-gradient(145deg, rgba(255,77,184,.35), rgba(95,81,255,.35));
          border:1px solid rgba(255,255,255,.14); box-shadow:0 25px 60px rgba(130,65,255,.2);
          transform:rotate(8deg);
        }
        .hero-orb span { font-size:64px; font-weight:800; transform:rotate(-8deg); }
        .grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:18px; }
        .card { border-radius:28px; padding:28px; }
        .section-head { display:flex; gap:16px; align-items:flex-start; margin-bottom:22px; }
        .index { color:rgba(255,255,255,.28); font-weight:700; font-size:12px; margin-top:5px; }
        .method-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .method {
          text-align:left; padding:16px; border-radius:18px; border:1px solid rgba(255,255,255,.08);
          color:#fff; background:rgba(0,0,0,.18); cursor:pointer; transition:.2s ease;
        }
        .method:hover { transform:translateY(-1px); border-color:rgba(255,255,255,.17); }
        .method.active { border-color:rgba(255,255,255,.35); background:linear-gradient(145deg, rgba(255,79,187,.15), rgba(99,84,255,.13)); }
        .method span, .method small { display:block; }
        .method span { font-weight:750; }
        .method small { color:rgba(255,255,255,.45); margin-top:4px; font-size:11px; }
        .number-card {
          margin:16px 0; padding:17px; border-radius:20px; display:flex; align-items:center; justify-content:space-between; gap:16px;
          background:rgba(0,0,0,.22); border:1px solid rgba(255,255,255,.08);
        }
        .label, .number-card small { display:block; color:rgba(255,255,255,.42); font-size:10px; letter-spacing:.15em; }
        .number-card strong { display:block; margin:5px 0; font-size:22px; letter-spacing:.04em; }
        .copy-button {
          border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.07); color:#fff;
          border-radius:12px; padding:10px 13px; cursor:pointer;
        }
        .notice { padding:15px 16px; border-radius:17px; background:rgba(255,205,92,.07); border:1px solid rgba(255,205,92,.12); }
        .notice strong { font-size:12px; letter-spacing:.08em; }
        .notice p { margin:7px 0 0; color:rgba(255,255,255,.55); font-size:12px; line-height:1.6; }
        .instructions { margin-top:18px; display:grid; gap:11px; }
        .instructions > div { display:flex; gap:12px; }
        .instructions span { flex:0 0 27px; height:27px; border-radius:50%; display:grid; place-items:center; background:rgba(255,255,255,.08); color:rgba(255,255,255,.65); font-size:11px; }
        .instructions p { margin:2px 0 0; color:rgba(255,255,255,.58); font-size:12px; line-height:1.55; }
        .donation-form { display:grid; gap:14px; }
        label { display:grid; gap:7px; color:rgba(255,255,255,.66); font-size:12px; }
        input, select, textarea {
          width:100%; color:#fff; background:rgba(0,0,0,.22); border:1px solid rgba(255,255,255,.1);
          border-radius:15px; padding:13px 14px; outline:none; transition:.2s ease; resize:vertical;
        }
        input:focus, select:focus, textarea:focus { border-color:rgba(255,255,255,.3); box-shadow:0 0 0 4px rgba(255,255,255,.035); }
        select { appearance:none; }
        .two { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .optional { color:rgba(255,255,255,.35); }
        .submit-button {
          border:0; padding:15px; border-radius:16px; cursor:pointer; color:#0a0a0d; font-weight:800;
          background:linear-gradient(135deg, #fff, #e9e5ff); box-shadow:0 18px 40px rgba(255,255,255,.12);
        }
        .submit-button:disabled { opacity:.55; cursor:wait; }
        .form-status { margin-top:14px; padding:14px; border-radius:16px; background:rgba(100,255,170,.07); border:1px solid rgba(100,255,170,.13); }
        .form-status.error { background:rgba(255,80,100,.07); border-color:rgba(255,80,100,.13); }
        .form-status strong, .form-status p, .form-status small { display:block; }
        .form-status p { margin:6px 0; color:rgba(255,255,255,.62); font-size:12px; line-height:1.55; }
        .form-status small { color:rgba(255,255,255,.42); }
        .verification-note { margin:14px 0 0; color:rgba(255,255,255,.4); font-size:11px; line-height:1.55; }
        .how { margin-top:18px; border-radius:28px; padding:28px; }
        .flow { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-top:20px; }
        .flow > div { padding:18px; border-radius:18px; background:rgba(0,0,0,.16); border:1px solid rgba(255,255,255,.07); }
        .flow span { display:block; color:rgba(255,255,255,.3); font-size:10px; letter-spacing:.12em; }
        .flow strong { display:block; margin-top:22px; font-size:18px; }
        .flow p { margin:7px 0 0; color:rgba(255,255,255,.5); font-size:12px; line-height:1.55; }
        .footer { display:flex; justify-content:space-between; gap:20px; padding:28px 2px; color:rgba(255,255,255,.35); font-size:11px; }
        .footer > span:last-child { display:flex; gap:16px; }
        .honeypot { position:absolute !important; left:-10000px !important; opacity:0 !important; height:0 !important; width:0 !important; pointer-events:none !important; }
        @media (max-width: 840px) {
          .hero { padding:27px; }
          .hero-orb { flex-basis:110px; width:110px; height:110px; border-radius:35px; }
          .hero-orb span { font-size:48px; }
          .grid { grid-template-columns:1fr; }
          .flow { grid-template-columns:1fr; }
        }
        @media (max-width: 560px) {
          .donation-shell { padding:13px; }
          .topbar { padding-bottom:18px; }
          nav { gap:11px; font-size:11px; }
          .hero { flex-direction:column; align-items:flex-start; min-height:auto; }
          .hero-orb { align-self:flex-end; }
          .card, .how { padding:21px; border-radius:23px; }
          .two { grid-template-columns:1fr; }
          .footer { flex-direction:column; }
          .footer > span:last-child { flex-wrap:wrap; }
        }
      `}
      </style>
    </main>
  );
}
