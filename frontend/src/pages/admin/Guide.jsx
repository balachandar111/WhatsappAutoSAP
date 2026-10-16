import { useState } from 'react';

const SECTIONS = [
  { title: '0 · Quick test with the Meta TEST number (do this first — no business verification needed)', items: [
    ['Meta App Dashboard → WhatsApp → API Setup → Step 1. Copy the test Phone Number ID and the WhatsApp Business Account ID → Setup page', 'https://developers.facebook.com/apps'],
    ['Click “Generate token” on that page (temporary, valid ~24 h) → paste as Access token in Setup. App Settings → Basic → App ID + App Secret → Setup'],
    ['Same page → “To” dropdown → Manage phone number list → add YOUR mobile number and enter the OTP (a test number can only message up to 5 verified recipients)'],
    ['Setup page → Save → run “Test WhatsApp” (required), then Check token, Subscribe app and Send hello_world to your number'],
    ['Local testing only: start ngrok (ngrok http 5000) and set it as PUBLIC_URL in backend/.env, then restart the backend. Then Meta → WhatsApp → Configuration → Edit webhook → paste the Callback URL + Verify token shown on the Setup page → Verify and save → subscribe to “messages”'],
    ['From your phone, reply to the hello_world message (or send “hi” to the test number) → the menu appears'],
    ['Razorpay TEST keys → Setup → Test Razorpay. Settings → Webhooks → add the URL shown on Setup with events payment_link.paid / expired / cancelled, paste the same secret'],
  ]},
  { title: 'A · Before you start (prerequisites)', items: [
    ['Personal Facebook account that will be the admin'],
    ['Meta Business Portfolio created', 'https://business.facebook.com'],
    ['Meta Developer account registered', 'https://developers.facebook.com'],
    ['A dedicated phone number that can receive SMS/voice OTP and is NOT registered on WhatsApp / WhatsApp Business app'],
    ['Business documents ready (GST / Udyam / shop licence / incorporation certificate, address proof) for Business Verification'],
    ['Business website or page with a Privacy Policy URL (needed to make the app Live)'],
    ['Payment method (card) for Meta billing'],
    ['Razorpay account (test mode is fine to start)', 'https://dashboard.razorpay.com'],
    ['Public HTTPS URL for this backend (domain, or ngrok for testing)'],
  ]},
  { title: 'B · Meta app configuration', items: [
    ['Start Business Verification: Business Settings → Security Center'],
    ['Create app: developers.facebook.com → Create App → WhatsApp use case → select your Business Portfolio', 'https://developers.facebook.com/apps'],
    ['App dashboard → WhatsApp → API Setup → “Start using the API”; connect/create your WhatsApp Business Account'],
    ['Copy the Phone Number ID and the WhatsApp Business Account ID → paste in Setup page'],
    ['Send the sample hello_world message to your own number using the temporary token (24h) to confirm it works'],
    ['Add your real number: API Setup → Add phone number → business profile + display name → verify OTP'],
    ['Enable two-step verification PIN for the number'],
    ['Business Settings → System users → create user → Add Assets (your app: Develop App; your WhatsApp account: Full Control)'],
    ['System user → Generate Token with whatsapp_business_messaging + whatsapp_business_management → paste as Permanent access token'],
    ['App Settings → Basic → copy App Secret → paste in Setup page'],
    ['In Setup page: Generate a verify token and click Save — your personal Callback URL appears below the Meta section'],
    ['Meta → WhatsApp → Configuration → Webhook: paste callback URL + verify token → Verify and save → subscribe to “messages”'],
    ['App Settings → Basic: add Privacy Policy URL + category, then switch the app to LIVE mode'],
  ]},
  { title: 'C · Catalog (optional)', items: [
    ['Commerce Manager → create an E-commerce catalog and add products with price + image', 'https://business.facebook.com/commerce'],
    ['Each product’s Content ID must equal the product Code in this app (e.g. SW001)'],
    ['WhatsApp Manager → connect the catalog to your number; make catalog & cart visible'],
    ['Paste Catalog ID in Setup page (leave empty to use list menus instead)'],
  ]},
  { title: 'D · Billing & templates', items: [
    ['Add a payment method in WhatsApp Manager / Business Settings → Payments'],
    ['(Ecommerce admins) Setup page → “Create the order templates”, then wait for APPROVED status'],
  ]},
  { title: 'E · Razorpay (Ecommerce admins)', items: [
    ['Dashboard → Settings → API Keys → paste Key ID + Key Secret in Setup page'],
    ['Settings → Webhooks → add the Razorpay URL shown on Setup page, choose the secret, events: payment_link.paid / expired / cancelled'],
    ['Paste the same webhook secret in Setup page'],
  ]},
  { title: 'E2 · Categories, products, outlets & delivery (Ecommerce admins)', items: [
    ['Categories page: create the menu categories first (e.g. Sweets, Savouries)'],
    ['Outlets page: correct address, phone, latitude/longitude and opening hours for every outlet'],
    ['Setup → Business: delivery charge, free-delivery threshold and max delivery distance'],
    ['Products page: sizes (250g/500g/1kg), prices, and tick outlets where an item is out of stock'],
    ['Delivery partner: assign rider name/phone/tracking link on each order (Porter / Dunzo / Swiggy Genie API integration needs their business credentials)'],
  ]},
  { title: 'F · Go-live checks', items: [
    ['Setup page: “Test WhatsApp” passes (this unlocks Chat flows and Automations), then “Subscribe app” and “Send test message” succeed (and “Test Razorpay” for ordering)'],
    ['Send “hi” from a customer phone → your default automation answers. Ordering bot: menu → order → location → payment → order visible in the Orders page with the right outlet. Forms: answers appear under Form submissions'],
    ['Switch Razorpay to live keys and replace the temporary Meta token with a permanent System User token'],
  ]},
  { title: 'G · Chat flows & automations (unlocked after Setup is tested)', items: [
    ['Chat flows → New flow → build your question tree: Message/Options, Product cards, Instruction steps, Forms. The phone preview on the right shows how it looks on WhatsApp'],
    ['Fix any red “Must fix” items (WhatsApp limits: up to 3 reply buttons or a list menu, titles 20/24 characters, 1024-character messages, up to 10 product cards per node). Click Save flow — the server re-checks it and a flow with no errors becomes Ready (live). You can also import/export a flow as Excel'],
    ['Automations → New automation → pick the Ready flow (or the built-in ordering bot), choose a trigger (default for any new chat, and/or keywords) and switch it Active. Use “Test” to try it without sending anything'],
    ['Send the trigger word from a phone to your WhatsApp number and check that the flow runs. Edits you save to a Ready flow go live in its automations immediately'],
  ]},
];
export default function Guide() {
  const [done, setDone] = useState(() => { try { return JSON.parse(localStorage.getItem('guide') || '{}'); } catch { return {}; } });
  const toggle = (k) => { const n = { ...done, [k]: !done[k] }; setDone(n); try { localStorage.setItem('guide', JSON.stringify(n)); } catch { /* storage unavailable */ } };
  const total = SECTIONS.reduce((t, s) => t + s.items.length, 0);
  const count = Object.values(done).filter(Boolean).length;

  return (
    <>
      <h1>Setup Guide <small className="muted">({count}/{total} done)</small></h1>
      <p className="muted">Tick items as you complete them (saved in this browser). Enter the credentials on the <b>Setup</b> page.</p>
      {SECTIONS.map((sec, si) => (
        <div className="card" key={si}>
          <h3>{sec.title}</h3>
          {sec.items.map(([text, link], ii) => {
            const k = `${si}-${ii}`;
            return (
              <label key={k} className={`check todo ${done[k] ? 'done' : ''}`}>
                <input type="checkbox" checked={!!done[k]} onChange={() => toggle(k)} />
                <span>{text} {link && <a href={link} target="_blank" rel="noreferrer">↗</a>}</span>
              </label>
            );
          })}
        </div>
      ))}
    </>
  );
}
