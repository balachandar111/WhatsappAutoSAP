import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Copy, Loader, PageHeader } from '../../components/common';
import { fmtDate } from '../../lib/ui';

const genToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
const SECRETS = ['waToken', 'appSecret', 'rzpKeySecret', 'rzpWebhookSecret'];

export default function Setup() {
  const { setup, setupReady, isEcommerce, refreshSetup } = useAuth();
  const [v, setV] = useState(null);          // plain values
  const [sec, setSec] = useState({});        // secret inputs (empty = keep the saved one)
  const [clear, setClear] = useState([]);    // secrets to erase
  const [masked, setMasked] = useState({});  // masked hints from the server
  const [hooks, setHooks] = useState({});    // webhook URLs for THIS admin
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null);
  const [out, setOut] = useState({});        // results of the test buttons
  const [testTo, setTestTo] = useState('');
  const [templates, setTemplates] = useState(null);
  const [busy, setBusy] = useState('');

  const apply = (r) => {
    setV(r.values); setMasked(r.secrets); setHooks(r.webhook || {}); setSec({}); setClear([]); setDirty(false);
  };
  const load = async () => apply((await api('/setup')).data);
  useEffect(() => { load().catch((e) => setMsg({ ok: false, text: e.message })); }, []); // eslint-disable-line
  if (!v) return msg ? <div className="error">{msg.text}</div> : <Loader />;

  const set = (k) => (e) => { setV({ ...v, [k]: e.target.value }); setDirty(true); };
  const setS = (k) => (e) => { setSec({ ...sec, [k]: e.target.value }); setClear(clear.filter((c) => c !== k)); setDirty(true); };
  const eraseSecret = (k) => { setSec({ ...sec, [k]: '' }); setClear([...clear, k]); setDirty(true); };

  const save = async (e) => {
    e?.preventDefault(); setMsg(null); setBusy('save');
    try {
      const body = { ...v, ...Object.fromEntries(SECRETS.map((k) => [k, sec[k] || ''])), clear };
      const r = await api('/setup', { method: 'PUT', body });
      apply(r.data); await refreshSetup();
      setMsg({ ok: true, text: 'Saved ✅ Secrets are stored encrypted. Now run “Test WhatsApp” below — changing the token, phone number ID, app secret or Graph version resets the test.' });
    } catch (er) { setMsg({ ok: false, text: er.message }); }
    setBusy('');
  };

  const run = (key, fn) => async () => {
    setBusy(key); setOut((o) => ({ ...o, [key]: null }));
    try { const text = await fn(); setOut((o) => ({ ...o, [key]: { ok: true, text } })); }
    catch (er) { setOut((o) => ({ ...o, [key]: { ok: false, text: er.message } })); }
    await refreshSetup();
    setBusy('');
  };

  const testWA = run('wa', async () => {
    const r = await api('/setup/test-whatsapp', { method: 'POST' });
    const i = r.info || {};
    return `Connected ✅  ${i.verified_name || ''} · ${i.display_phone_number || ''} · quality: ${i.quality_rating || 'n/a'} · name status: ${i.name_status || 'n/a'}\nChat flows and automations are now unlocked.`;
  });
  const testTok = run('tok', async () => {
    const { info: i } = await api('/setup/test-token', { method: 'POST' });
    if (!i.valid) throw new Error(`Token is INVALID ❌ ${i.error || ''}`);
    return `Token is VALID ✅\nType: ${i.type} · belongs to your App ID: ${i.appMatches ? 'yes ✅' : 'NO ❌'}\nExpires: ${i.expires}\nPermissions: ${(i.scopes || []).join(', ') || '(none)'}${i.expires !== 'never (permanent)' ? '\n⚠ Temporary token — fine for testing, generate a permanent System User token before go-live.' : ''}`;
  });
  const subscribe = run('sub', async () => {
    const r = await api('/setup/subscribe-app', { method: 'POST' });
    return `App subscribed to your WhatsApp Business Account ✅\nSubscribed apps: ${(r.apps || []).join(', ') || '(none listed)'}`;
  });
  const sendTest = (mode) => run('send', async () => {
    const r = await api('/setup/send-test', { method: 'POST', body: { to: testTo, mode } });
    return `${r.message || 'Message sent'} ✅ — check WhatsApp`;
  })();
  const testRzp = run('rzp', async () => { const r = await api('/setup/test-razorpay', { method: 'POST' }); return `${r.message || 'Razorpay keys valid'} ✅`; });
  const loadTpl = run('tpl', async () => { const t = (await api('/setup/templates')).data; setTemplates(t); return `${t.length} template(s) found`; });
  const createTpl = run('tpl', async () => {
    const r = (await api('/setup/templates/defaults', { method: 'POST' })).data;
    setTemplates((await api('/setup/templates').catch(() => ({}))).data || null);
    return r.map((x) => `${x.name}: ${x.ok ? 'submitted for approval ✅' : '⚠ ' + x.error}`).join('\n');
  });

  const Result = ({ k }) => (out[k] ? <pre className={out[k].ok ? 'success' : 'error'}>{out[k].text}</pre> : null);
  const field = (label, k, ph, type = 'text') => <label>{label}<input type={type} value={v[k] ?? ''} onChange={set(k)} placeholder={ph} /></label>;
  const secret = (label, k) => (
    <label>{label}
      <div className="inline">
        <input type="password" autoComplete="new-password" value={sec[k] || ''} onChange={setS(k)}
          placeholder={clear.includes(k) ? 'Will be erased on save' : masked[k] ? `${masked[k]}  (saved — leave blank to keep)` : 'Not set'} />
        {masked[k] && !clear.includes(k) && <button type="button" className="btn small ghost" onClick={() => eraseSecret(k)}>Erase</button>}
      </div>
    </label>
  );

  const waInfo = setup?.whatsappInfo;
  const locked = dirty ? 'Save your changes first' : undefined;
  const Pill = ({ done, n, children }) => <div className={`step-pill ${done ? 'done' : ''}`}><span className="ico">{done ? '✓' : n}</span>{children}</div>;

  return (
    <>
      <PageHeader title="WhatsApp Setup"
        subtitle={<>Enter the values from Meta{isEcommerce ? ' and Razorpay' : ''} (see the <Link to="/app/guide">Setup guide</Link> for where to find each one). Secrets are encrypted and never shown in full again.</>} />

      <div className="card">
        <div className="row-between">
          <h3 style={{ margin: 0 }}>Setup progress</h3>
          {setupReady && <Link className="btn small" to="/app/flows">Build your first chat flow →</Link>}
        </div>
        <div className="steps-row">
          <Pill n="1" done={setup?.whatsappConfigured}>Credentials saved</Pill>
          <Pill n="2" done={setupReady}>WhatsApp test passed</Pill>
          <Pill n="3" done={!!setup?.webhookSubscribedAt}>App subscribed (recommended)</Pill>
        </div>
        {setupReady
          ? <div className="success" style={{ marginBottom: 0 }}>✅ WhatsApp is connected{waInfo?.display_phone_number ? ` (${waInfo.display_phone_number}${waInfo.verified_name ? ` · ${waInfo.verified_name}` : ''})` : ''}{setup?.whatsappVerifiedAt ? ` — tested ${fmtDate(setup.whatsappVerifiedAt)}` : ''}. <b>Chat flows</b> and <b>Automations</b> are unlocked.</div>
          : <p className="muted">Save Access token, Phone Number ID and App Secret, then run <b>Test WhatsApp</b> to unlock Chat flows and Automations.{setup?.missing?.length ? <> Still missing: <b>{setup.missing.join(', ')}</b>.</> : null}</p>}
      </div>

      <form onSubmit={save}>
        <div className="card">
          <h3>1 · Business</h3>
          <div className="grid2">
            {field('Business / shop name (used in messages)', 'shopName', 'Krishna Jelabi Kadai')}
            {field('Owner WhatsApp alert number (optional, with country code)', 'ownerPhone', '919876543210')}
            {isEcommerce && <>
              {field('Order ID prefix (1–6 letters/numbers)', 'orderPrefix', 'ORD')}
              {field('Delivery charge ₹ (0 = free)', 'deliveryFee', '40', 'number')}
              {field('Free delivery above ₹ (0 = never)', 'freeDeliveryAbove', '500', 'number')}
              {field('Max delivery distance from an outlet, km (0 = no limit)', 'maxDeliveryKm', '8', 'number')}
            </>}
          </div>
          {isEcommerce && <label style={{ marginTop: 12 }}>Welcome message (optional)<textarea rows={2} value={v.welcomeMessage || ''} onChange={set('welcomeMessage')} placeholder="Shown when a customer starts the ordering bot" /></label>}
        </div>

        <div className="card">
          <h3>2 · Meta WhatsApp Cloud API</h3>
          <div className="grid2">
            {field('App ID', 'appId', 'App Settings → Basic')}
            {secret('App Secret', 'appSecret')}
            {field('Graph API version', 'graphVersion', 'v25.0')}
            {field('Phone Number ID', 'phoneNumberId', 'from the API Setup page')}
            {field('WhatsApp Business Account ID (WABA)', 'wabaId', 'needed for templates & app subscription')}
            {secret('Permanent access token (System User)', 'waToken')}
            {field('Catalog ID (optional)', 'catalogId', 'leave empty to use list menus')}
            <label>Webhook verify token
              <div className="inline">
                <input value={v.verifyToken || ''} onChange={set('verifyToken')} placeholder="min 8 characters" />
                <button type="button" className="btn small secondary" onClick={() => { setV({ ...v, verifyToken: genToken() }); setDirty(true); }}>Generate</button>
              </div>
            </label>
          </div>
          <div className="webhook-box">
            <b>Paste into Meta → WhatsApp → Configuration → Webhook:</b>
            <div className="inline"><code>{hooks.url || '—'}</code>{hooks.url && <Copy text={hooks.url} />}</div>
            <div className="inline"><span className="muted">Verify token:</span><code>{hooks.verifyToken || '—'}</code>{hooks.verifyToken && <Copy text={hooks.verifyToken} />}</div>
            <span className="muted">This URL is unique to your account. Subscribe to the <b>messages</b> field. Save these settings BEFORE clicking “Verify and save” in Meta. The URL uses the backend's <code>PUBLIC_URL</code> — it must be public HTTPS (domain or ngrok).</span>
          </div>
        </div>

        {isEcommerce && (
          <div className="card">
            <h3>3 · Razorpay <span className="muted">(only for the built-in ordering bot)</span></h3>
            <div className="grid2">
              {field('Key ID', 'rzpKeyId', 'rzp_test_xxxxx')}
              {secret('Key Secret', 'rzpKeySecret')}
              {secret('Webhook secret', 'rzpWebhookSecret')}
            </div>
            <div className="webhook-box">
              <b>Paste into Razorpay → Settings → Webhooks:</b>
              <div className="inline"><code>{hooks.razorpayUrl || '—'}</code>{hooks.razorpayUrl && <Copy text={hooks.razorpayUrl} />}</div>
              <span className="muted">Events: payment_link.paid, payment_link.expired, payment_link.cancelled</span>
            </div>
          </div>
        )}

        {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
        <button className="btn" disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : dirty ? 'Save settings •' : 'Save settings'}</button>
        {dirty && <span className="muted" style={{ marginLeft: 12 }}>You have unsaved changes</span>}
      </form>

      <h2 style={{ margin: '28px 0 12px' }}>Test your setup</h2>
      {dirty && <div className="warn" style={{ marginTop: 0 }}>Save your changes before testing — tests use the saved values.</div>}
      <div className="card">
        <div className="row-between"><h3>1 · Test WhatsApp connection</h3>{setupReady && <span className="badge green">Passed</span>}</div>
        <p className="muted">Checks the saved token + Phone Number ID against Meta. <b>Required</b> — a pass unlocks Chat flows and Automations.</p>
        <button className="btn" onClick={testWA} disabled={busy === 'wa' || dirty} title={locked}>{busy === 'wa' ? 'Testing…' : 'Test WhatsApp'}</button>
        <Result k="wa" />
        <hr />
        <h3>2 · Check access token <span className="muted">(optional)</span></h3>
        <p className="muted">Uses App ID + App Secret to show whether the token is valid, temporary or permanent, and which permissions it has.</p>
        <button className="btn secondary" onClick={testTok} disabled={busy === 'tok' || dirty} title={locked}>{busy === 'tok' ? 'Checking…' : 'Check token'}</button>
        <Result k="tok" />
        <hr />
        <div className="row-between"><h3>3 · Subscribe app to the WhatsApp account</h3>{setup?.webhookSubscribedAt && <span className="badge green">Done</span>}</div>
        <p className="muted">Needed so Meta delivers customer messages to your webhook. Recommended.</p>
        <button className="btn secondary" onClick={subscribe} disabled={busy === 'sub' || dirty} title={locked}>Subscribe app to WABA</button>
        <Result k="sub" />
        <hr />
        <h3>4 · Send a test message</h3>
        <div className="inline">
          <input placeholder="919876543210 (with country code)" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn secondary" onClick={() => sendTest('template')} disabled={busy === 'send' || dirty || !testTo}>Send hello_world template</button>
          <button className="btn secondary" onClick={() => sendTest('text')} disabled={busy === 'send' || dirty || !testTo}>Send text (needs open 24h window)</button>
        </div>
        <Result k="send" />
        {isEcommerce && (
          <>
            <hr />
            <h3>5 · Test Razorpay keys</h3>
            <button className="btn secondary" onClick={testRzp} disabled={busy === 'rzp' || dirty}>Test Razorpay</button>
            <Result k="rzp" />
          </>
        )}
      </div>

      {isEcommerce && (
        <div className="card">
          <h3>Message templates (for order status updates after 24 hours)</h3>
          <p className="muted" style={{ marginBottom: 10 }}>Status updates are sent as a normal message first; if the customer's 24-hour window is closed they fall back to the approved <code>order_packed / order_ready / order_dispatched / order_delivered / order_cancelled</code> templates.</p>
          <div className="inline">
            <button className="btn secondary" onClick={loadTpl} disabled={busy === 'tpl' || dirty}>Refresh list</button>
            <button className="btn" onClick={createTpl} disabled={busy === 'tpl' || dirty}>Create the order templates</button>
          </div>
          <Result k="tpl" />
          {templates && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Name</th><th>Category</th><th>Language</th><th>Status</th></tr></thead>
                <tbody>{templates.map((x) => (
                  <tr key={x.name + x.language}><td>{x.name}</td><td>{x.category}</td><td>{x.language}</td>
                    <td><span className={`badge ${x.status === 'APPROVED' ? 'green' : x.status === 'REJECTED' ? 'red' : 'orange'}`}>{x.status}</span></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
