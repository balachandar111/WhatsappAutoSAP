/*
|--------------------------------------------------------------------------
| Flow data model (same shape as the chatbot project's Chatbot.flow)
|--------------------------------------------------------------------------
| flow = { [language]: { start: "Q1", questions: { Q1: node, Q2: node … } } }
|
| node.nodeType:
|   message  -> { text, isEnd, options: [{ label, text, next, url, handoff }] }   (handoff: '' | 'commerce' = pass chat to the ordering bot)
|   products -> { text, products: [{ image, title, description, buttonText, redirectUrl }], productsNext }
|   steps    -> { text, steps: [{ image, title, desc }], stepsNext, closingTitle, closingMessage, closingImage }
|   form     -> { text, formFields: [{ key, label, fieldType, required, placeholder, options, showIf }],
|                 formSubmitLabel, formNext }
|
| Shop nodes (need Ecommerce operations) read the admin's LIVE Product / Category / Branch pages - nothing is typed into the flow:
|   shop     -> { text, shopCategories: [key], shopProducts: [code], shopExtras: [{ text, description, next }], checkoutNext }
|   checkout -> { allowDelivery, allowPickup, askName, namePrompt, addressPrompt }
|   bulk     -> { text, bulkOccasions: [{ key, label }], bulkDetailsPrompt, bulkDatePrompt, bulkSuccessText, bulkNext }
|   track    -> { trackNext }          outlets -> { outletsMaps, outletsNext }
|
| How each node renders on WhatsApp (see WhatsAppPreview.jsx):
|   message  -> text + up to 3 reply buttons, or a list menu (4–10 rows)
|   products -> one image message per card (title, description, link in caption) + optional "Continue" button
|   steps    -> one image message per step with Back / Next buttons, then a closing message
|   form     -> the bot asks each field as a question, one at a time (buttons/list for dropdowns,
|               "send a photo" for file fields, typed answers for the rest)
|
| The backend (services/flowValidator.js) is the authority: it re-validates on every save and only a valid flow becomes
| "ready" / live. validateFlow() below mirrors those rules so problems show up while you type.
*/

// Suggested languages. The backend accepts any lowercase name (a-z, 0-9, "-"; 2-20 chars; max 6 per flow).
export const LANGS = { english: 'English', tamil: 'Tamil', hindi: 'Hindi', telugu: 'Telugu', kannada: 'Kannada', malayalam: 'Malayalam', marathi: 'Marathi', bengali: 'Bengali', gujarati: 'Gujarati' };
export const LANG_RE = /^[a-z][a-z0-9-]{1,19}$/;
export const MAX_LANGS = 6;
export const langLabel = (l) => LANGS[l] || (l ? l.charAt(0).toUpperCase() + l.slice(1) : l);

export const NODE_TYPES = {
  message: { icon: '💬', label: 'Message / Options' },
  products: { icon: '🖼️', label: 'Product cards (manual)' },
  steps: { icon: '📋', label: 'Instruction steps' },
  form: { icon: '📝', label: 'Form (questions)' },
  shop: { icon: '🛍️', label: 'Shop menu (live products)', commerce: true },
  checkout: { icon: '🧾', label: 'Checkout & payment', commerce: true },
  bulk: { icon: '🎁', label: 'Bulk / gifting enquiry', commerce: true },
  track: { icon: '📦', label: 'Track my order', commerce: true },
  outlets: { icon: '📍', label: 'Our outlets', commerce: true },
};
export const COMMERCE_TYPES = Object.keys(NODE_TYPES).filter((k) => NODE_TYPES[k].commerce);
export const isCommerceType = (t) => COMMERCE_TYPES.includes(t);

export const DEFAULT_OCCASIONS = [
  { key: 'wedding', label: '💍 Wedding' }, { key: 'festival', label: '🪔 Festival gifting' },
  { key: 'corporate', label: '🏢 Corporate' }, { key: 'other', label: '🎉 Other / catering' },
];
export const DEFAULT_SHOP_TEXT = '🙏 Welcome to *{shop}*!\nWhat would you like to do?';
export const SHOP_LIMITS = { EXTRAS_MAX: 6, ROWS_MAX: 10, OCCASIONS_MAX: 10 };

export const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'tel', label: 'Phone number' },
  { value: 'email', label: 'Email' },
  { value: 'date', label: 'Date (DD/MM/YYYY)' },
  { value: 'textarea', label: 'Long text' },
  { value: 'file', label: 'Photo / file the customer sends' },
  { value: 'select', label: 'Choice list (buttons / list)' },
];

// WhatsApp Cloud API interactive-message limits
export const WA = { BODY_MAX: 1024, BUTTONS_MAX: 3, BUTTON_TITLE: 20, LIST_MAX: 10, LIST_TITLE: 24, CARDS_MAX: 10, STEPS_MAX: 20, FIELDS_MAX: 15, CHOICES_MAX: 10, OPTIONS_MAX: 30 };

// 1–3 options -> reply buttons; 4–10 -> list menu; 11–30 -> list menu split over pages ("More…" row)
export const choiceKind = (count) => (count <= WA.BUTTONS_MAX ? 'buttons' : count <= WA.LIST_MAX ? 'list' : count <= WA.OPTIONS_MAX ? 'paged' : 'too_many');
export const titleLimit = (count) => (count <= WA.BUTTONS_MAX ? WA.BUTTON_TITLE : WA.LIST_TITLE);

export const blankMessage = () => ({ nodeType: 'message', text: '', options: [], isEnd: false });
export const blankFlow = () => ({ start: 'Q1', questions: { Q1: blankMessage() } });

// Switching a node's type keeps its text and starts the new type with sensible defaults
export function convertNode(t, old = {}) {
  const base = { text: old.text || '', isEnd: false };
  switch (t) {
    case 'message': return { ...base, nodeType: t, options: old.options || [] };
    case 'products': return { ...base, nodeType: t, products: old.products || [], productsNext: null };
    case 'steps': return { ...base, nodeType: t, steps: old.steps || [], stepsNext: null };
    case 'form': return { ...base, nodeType: t, formFields: old.formFields || [], formSubmitLabel: 'Submit', formNext: null };
    case 'shop': return { nodeType: t, isEnd: false, text: old.text || DEFAULT_SHOP_TEXT, shopCategories: [], shopProducts: [], shopExtras: [], checkoutNext: null };
    case 'checkout': return { nodeType: t, isEnd: false, text: '', allowDelivery: true, allowPickup: true, askName: true, namePrompt: '', addressPrompt: '' };
    case 'bulk': return { nodeType: t, isEnd: false, text: old.text || '🎁 *Bulk, gifting & catering*\nWhat is the occasion?', bulkOccasions: DEFAULT_OCCASIONS.map((o) => ({ ...o })), bulkDetailsPrompt: '', bulkDatePrompt: '', bulkSuccessText: '', bulkNext: null };
    case 'track': return { nodeType: t, isEnd: false, text: '', trackNext: null };
    case 'outlets': return { nodeType: t, isEnd: false, text: '', outletsMaps: true, outletsNext: null };
    default: return { ...base, nodeType: 'message', options: [] };
  }
}

// every field that can point at another node (used when a node is deleted)
export const NEXT_FIELDS = ['productsNext', 'stepsNext', 'formNext', 'checkoutNext', 'bulkNext', 'trackNext', 'outletsNext'];

export function nextNodeKey(questions) {
  let n = 1;
  while (questions[`Q${n}`]) n++;
  return `Q${n}`;
}

export function slugifyKey(label, existing) {
  let base = (label || 'field').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '') || 'field';
  let key = base, i = 2;
  while (existing.includes(key)) key = `${base}_${i++}`;
  return key;
}

export function nodeChildren(node) {
  const t = node.nodeType || 'message';
  if (t === 'message') return (node.options || []).map((o) => o.next).filter(Boolean);
  if (t === 'products') return node.productsNext ? [node.productsNext] : [];
  if (t === 'steps') return node.stepsNext ? [node.stepsNext] : [];
  if (t === 'form') return node.formNext ? [node.formNext] : [];
  if (t === 'shop') return [...(node.shopExtras || []).map((x) => x.next), node.checkoutNext].filter(Boolean);
  if (t === 'bulk') return node.bulkNext ? [node.bulkNext] : [];
  if (t === 'track') return node.trackNext ? [node.trackNext] : [];
  if (t === 'outlets') return node.outletsNext ? [node.outletsNext] : [];
  return [];
}

export function reachableFrom(questions, start) {
  const seen = new Set();
  const stack = questions[start] ? [start] : [];
  while (stack.length) {
    const k = stack.pop();
    if (seen.has(k)) continue;
    seen.add(k);
    nodeChildren(questions[k]).forEach((c) => questions[c] && stack.push(c));
  }
  return seen;
}

// Editor state from a saved document: one flow per enabled language
export function buildFlowState(doc) {
  const out = {};
  (doc.languages || ['english']).forEach((l) => { out[l] = doc.flow?.[l] || blankFlow(); });
  return out;
}

// A small, valid starting point so new flows aren't a blank page
export function starterFlow(lang = 'english') {
  const ta = lang === 'tamil';
  return {
    start: 'Q1',
    questions: {
      Q1: { nodeType: 'message', isEnd: false, text: ta ? 'வணக்கம்! 🙏 நான் எப்படி உதவலாம்?' : 'Hi there! 👋 How can we help you today?',
        options: [
          { label: 'A', text: ta ? 'எங்கள் பொருட்கள்' : 'See our products', next: 'Q2', url: '' },
          { label: 'B', text: ta ? 'தொடர்பு கொள்ள' : 'Talk to us', next: 'Q3', url: '' },
        ] },
      Q2: { nodeType: 'products', text: ta ? 'எங்கள் பிரபலமான பொருட்கள்:' : 'Our popular items:', products: [
        { image: '', title: ta ? 'பொருள் 1' : 'Product 1', description: ta ? 'சிறு விளக்கம்' : 'Short description', buttonText: 'View', redirectUrl: '' },
      ], productsNext: 'Q3' },
      Q3: { nodeType: 'form', text: ta ? 'உங்கள் விவரங்களை பகிரவும்:' : 'Share your details and we will call you back:', formFields: [
        { key: 'name', label: ta ? 'உங்கள் பெயர்' : 'Your name', fieldType: 'text', required: true, placeholder: '', options: [], showIf: null },
        { key: 'phone', label: ta ? 'தொலைபேசி எண்' : 'Phone number', fieldType: 'tel', required: true, placeholder: '', options: [], showIf: null },
      ], formSubmitLabel: 'Submit', formNext: 'Q4' },
      Q4: { nodeType: 'message', isEnd: true, text: ta ? 'நன்றி! விரைவில் தொடர்பு கொள்கிறோம் 🙏' : 'Thank you! We will get back to you shortly 🙏', options: [] },
    },
  };
}

/* ------------------------------ validation ------------------------------ */
// Mirrors backend/src/services/flowValidator.js. Returns { errors: [{lang,node,msg}], warnings: [...] }
const URL_RE = /^https?:\/\/[^\s]{3,2000}$/i;
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const NODE_KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function validateFlow(flow, languages, { ecommerce = true } = {}) {
  const errors = [], warnings = [];
  const E = (lang, node, msg) => errors.push({ lang, node, msg });
  const W = (lang, node, msg) => warnings.push({ lang, node, msg });

  (languages || Object.keys(flow || {})).forEach((lang) => {
    const lf = flow?.[lang];
    if (!lf || !Object.keys(lf.questions || {}).length) return E(lang, '—', 'This language has no nodes yet.');
    const q = lf.questions;
    if (!q[lf.start]) E(lang, '—', 'The start question does not exist — pick one in “Start question”.');
    else if ((q[lf.start].nodeType || 'message') === 'message' && q[lf.start].isEnd) E(lang, lf.start, 'The start question is a final message, so the bot would stop immediately. Pick a real first question as the start.');
    const exists = (k) => !k || !!q[k];
    const lim = (s, n) => (s || '').length > n;

    Object.entries(q).forEach(([key, node]) => {
      const t = node.nodeType || 'message';
      if (!NODE_KEY_RE.test(key)) E(lang, key, 'Node key can only use letters, numbers, “-” and “_” (max 40).');

      if (t === 'message') {
        if (!node.text?.trim()) E(lang, key, 'Message text is empty.');
        if (lim(node.text, WA.BODY_MAX)) W(lang, key, `Text is longer than ${WA.BODY_MAX} characters and will be cut on WhatsApp.`);
        if (node.isEnd) return;
        const opts = node.options || [];
        if (!opts.length) return E(lang, key, 'Add at least one option, or tick “final message”.');
        if (opts.length > WA.OPTIONS_MAX) E(lang, key, `A message can have at most ${WA.OPTIONS_MAX} options (you have ${opts.length}).`);
        const max = titleLimit(opts.length);
        opts.forEach((o, i) => {
          if (!o.text?.trim()) E(lang, key, `Option ${i + 1} has no text.`);
          else if (lim(o.text, max)) W(lang, key, `Option “${o.text}” is ${o.text.length} characters and will be shortened to ${max} on WhatsApp.`);
          if (!exists(o.next)) E(lang, key, `Option ${i + 1} points to a deleted node.`);
          if (o.url && !URL_RE.test(o.url)) E(lang, key, `Option ${i + 1}: link must start with http:// or https://`);
          if (o.handoff && !ecommerce) E(lang, key, `Option ${i + 1}: handing over to the ordering bot needs Ecommerce operations (ask the Super Admin).`);
        });
      }

      if (isCommerceType(t)) {
        if (!ecommerce) E(lang, key, `A “${NODE_TYPES[t].label}” node needs Ecommerce operations (ask the Super Admin).`);
        if (t === 'shop') {
          const xs = node.shopExtras || [];
          if (!node.text?.trim()) E(lang, key, 'Write the welcome message customers see above the menu.');
          if (xs.length > SHOP_LIMITS.EXTRAS_MAX) E(lang, key, `At most ${SHOP_LIMITS.EXTRAS_MAX} extra menu rows (you have ${xs.length}) — a WhatsApp list shows ${SHOP_LIMITS.ROWS_MAX} rows in total.`);
          xs.forEach((x, i) => {
            if (!x.text?.trim()) E(lang, key, `Extra menu row ${i + 1} has no text.`);
            else if (x.text.length > WA.LIST_TITLE) W(lang, key, `Extra row “${x.text}” is ${x.text.length} characters and will be shortened to ${WA.LIST_TITLE} on WhatsApp.`);
            if (!x.next) E(lang, key, `Extra menu row ${i + 1} must lead to a node.`);
            else if (!exists(x.next)) E(lang, key, `Extra menu row ${i + 1} points to a deleted node.`);
          });
          if (!node.checkoutNext) E(lang, key, 'Choose which node opens when the customer taps “Checkout”.');
          else if (!exists(node.checkoutNext)) E(lang, key, '“Checkout” points to a deleted node.');
        }
        if (t === 'checkout' && node.allowDelivery === false && node.allowPickup === false) E(lang, key, 'Allow home delivery, self pickup, or both.');
        if (t === 'bulk') {
          const os = node.bulkOccasions || [];
          if (!node.text?.trim()) E(lang, key, 'Write the intro text for the occasion list.');
          if (!os.length) E(lang, key, 'Add at least one occasion.');
          if (os.length > SHOP_LIMITS.OCCASIONS_MAX) E(lang, key, `At most ${SHOP_LIMITS.OCCASIONS_MAX} occasions (you have ${os.length}).`);
          os.forEach((o, i) => {
            if (!o.label?.trim()) E(lang, key, `Occasion ${i + 1} has no name.`);
            else if (o.label.length > WA.LIST_TITLE) W(lang, key, `Occasion “${o.label}” is ${o.label.length} characters and will be shortened to ${WA.LIST_TITLE} on WhatsApp.`);
          });
          if (!exists(node.bulkNext)) E(lang, key, '“After the enquiry, continue to” points to a deleted node.');
        }
        if (t === 'track' && !exists(node.trackNext)) E(lang, key, '“After the status, continue to” points to a deleted node.');
        if (t === 'outlets' && !exists(node.outletsNext)) E(lang, key, '“After the outlets, continue to” points to a deleted node.');
      }

      if (t === 'products') {
        const ps = node.products || [];
        if (!node.text?.trim()) E(lang, key, 'Add a heading text for the product cards.');
        if (!ps.length) E(lang, key, 'Add at least one product card.');
        if (ps.length > WA.CARDS_MAX) E(lang, key, `At most ${WA.CARDS_MAX} cards per node (you have ${ps.length}). Split them across two nodes.`);
        ps.forEach((p, i) => {
          if (!p.title?.trim()) E(lang, key, `Card ${i + 1} has no title.`);
          if (p.image && !URL_RE.test(p.image)) E(lang, key, `Card ${i + 1}: image link must start with http:// or https://`);
          if (p.redirectUrl && !URL_RE.test(p.redirectUrl)) E(lang, key, `Card ${i + 1}: button link must start with http:// or https://`);
          else if (!p.redirectUrl) W(lang, key, `Card ${i + 1} has no button link, so it is sent as a plain picture/text.`);
        });
        if (!exists(node.productsNext)) E(lang, key, '“Continue to” points to a deleted node.');
      }

      if (t === 'steps') {
        const ss = node.steps || [];
        if (!node.text?.trim()) E(lang, key, 'Add a heading text for the steps.');
        if (!ss.length) E(lang, key, 'Add at least one step.');
        if (ss.length > WA.STEPS_MAX) E(lang, key, `At most ${WA.STEPS_MAX} steps per node (you have ${ss.length}).`);
        ss.forEach((s, i) => {
          if (!s.title?.trim()) E(lang, key, `Step ${i + 1} has no title.`);
          if (s.image && !URL_RE.test(s.image)) E(lang, key, `Step ${i + 1}: image link must start with http:// or https://`);
        });
        if (node.closingImage && !URL_RE.test(node.closingImage)) E(lang, key, 'The closing image link must start with http:// or https://');
        if (!exists(node.stepsNext)) E(lang, key, '“After the last step, continue to” points to a deleted node.');
      }

      if (t === 'form') {
        const fs = node.formFields || [];
        const seen = new Set();
        if (!node.text?.trim()) E(lang, key, 'Add an intro text for the form.');
        if (!fs.length) E(lang, key, 'Add at least one form field.');
        if (fs.length > WA.FIELDS_MAX) E(lang, key, `At most ${WA.FIELDS_MAX} fields per form (you have ${fs.length}) — each one is a WhatsApp message.`);
        fs.forEach((f, i) => {
          const name = f.label || `${i + 1}`;
          if (!f.label?.trim() || !f.key?.trim()) E(lang, key, `Field ${i + 1} needs a question text and a key.`);
          else if (!FIELD_KEY_RE.test(f.key)) E(lang, key, `Field “${name}”: key “${f.key}” must start with a letter and use only letters, numbers and “_”.`);
          if (f.key && seen.has(f.key)) E(lang, key, `Duplicate field key “${f.key}”.`);
          seen.add(f.key);
          if (f.fieldType === 'select') {
            const opts = (f.options || []).map((o) => o.trim()).filter(Boolean);
            if (!opts.length) E(lang, key, `Choice field “${name}” needs at least one choice.`);
            if (opts.length > WA.CHOICES_MAX) E(lang, key, `Choice field “${name}” has ${opts.length} choices; WhatsApp allows ${WA.CHOICES_MAX}.`);
            if (new Set(opts).size !== opts.length) E(lang, key, `Choice field “${name}” has duplicate choices.`);
          }
          if (f.showIf?.field) {
            const trigger = fs.slice(0, i).find((x) => x.key === f.showIf.field);
            if (!trigger) E(lang, key, `Field “${name}” depends on “${f.showIf.field}”, which must be an earlier field in the same form.`);
            else if (trigger.fieldType !== 'select') E(lang, key, `Field “${name}” can only depend on a choice field.`);
            else if (!f.showIf.equals) E(lang, key, `Field “${name}”: pick which answer shows it.`);
            else if (!(trigger.options || []).includes(f.showIf.equals)) E(lang, key, `Field “${name}”: “${f.showIf.equals}” is not one of ${trigger.label}'s choices.`);
          }
        });
        if (!exists(node.formNext)) E(lang, key, '“After submit, continue to” points to a deleted node.');
      }
    });

    const reach = reachableFrom(q, lf.start);
    Object.keys(q).filter((k) => !reach.has(k)).forEach((k) => W(lang, k, 'Not reachable from the start question — customers will never see it.'));
  });

  return { errors, warnings };
}
