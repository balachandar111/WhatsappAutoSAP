/*
 Validates + sanitizes a chat flow (the shape the builder / Excel import produce):
   { [language]: { start: "Q1", questions: { Q1: { nodeType, text, ... } } } }
 Returns { flow, errors, warnings }. `flow` is a clean copy (unknown keys dropped, strings trimmed/capped);
 `errors` block the flow from going live; `warnings` are WhatsApp-specific things that will be shortened/ignored.
*/
const NODE_TYPES = ['message', 'products', 'form', 'steps'];
const FIELD_TYPES = ['text', 'number', 'tel', 'email', 'date', 'textarea', 'file', 'select'];
const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;            // node keys travel inside WhatsApp reply ids: no ":" allowed
const LANG_RE = /^[a-z][a-z0-9-]{1,19}$/;
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const URL_RE = /^https?:\/\/[^\s]{3,2000}$/i;

const LIMITS = { options: 30, cards: 10, steps: 20, fields: 15, selectChoices: 10 };

const str = (v, max) => (v === undefined || v === null ? '' : String(v)).trim().slice(0, max);
const strOrNull = (v) => { const s = str(v, 40); return s || null; };

function sanitizeFlow(input, { languages, ecommerce = true } = {}) {
  const errors = [];
  const warnings = [];
  const out = {};

  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length) {
    return { flow: {}, errors: ['The flow is empty. Add at least one language with a start question.'], warnings };
  }

  for (const lang of Object.keys(input)) {
    if (!LANG_RE.test(lang)) { errors.push(`Language "${lang}" is not valid (lowercase letters, e.g. english, tamil, hindi)`); continue; }
    const lf = input[lang] || {};
    const rawQ = lf.questions && typeof lf.questions === 'object' ? lf.questions : {};
    const L = `(${lang})`;
    const nodes = {};

    for (const key of Object.keys(rawQ)) {
      if (!KEY_RE.test(key)) { errors.push(`Node key "${key}" ${L} is not valid: use letters, numbers, "-" or "_" (max 40)`); continue; }
      const n = rawQ[key] || {};
      const type = NODE_TYPES.includes(n.nodeType) ? n.nodeType : (n.nodeType ? null : 'message');
      if (!type) { errors.push(`Node "${key}" ${L} has an unknown type "${n.nodeType}"`); continue; }
      const text = str(n.text, 4000);
      if (text.length > 1024 && type !== 'message') warnings.push(`Node "${key}" ${L}: text is longer than 1024 characters and will be cut on WhatsApp`);

      if (type === 'message') {
        const isEnd = !!n.isEnd;
        const options = (Array.isArray(n.options) ? n.options : []).map((o, i) => ({
          label: str(o?.label, 10) || String.fromCharCode(65 + (i % 26)),
          text: str(o?.text, 100),
          next: strOrNull(o?.next),
          url: str(o?.url, 2000),
          handoff: o?.handoff === 'commerce' ? 'commerce' : '',
        }));
        if (!ecommerce && options.some((o) => o.handoff)) errors.push(`Question "${key}" ${L}: handing over to the ordering bot needs Ecommerce operations, which are not enabled for your account`);
        if (!text) errors.push(`Question "${key}" ${L} has no text`);
        if (!isEnd && !options.length) errors.push(`Question "${key}" ${L} needs at least one option, or must be marked as an ending message`);
        if (options.length > LIMITS.options) errors.push(`Question "${key}" ${L} has ${options.length} options (max ${LIMITS.options})`);
        options.forEach((o) => {
          if (!o.text) errors.push(`An option in "${key}" ${L} has no text`);
          if (o.url && !URL_RE.test(o.url)) errors.push(`Option "${o.text}" in "${key}" ${L} has an invalid link (must start with http:// or https://)`);
          if (options.length <= 3 && o.text.length > 20) warnings.push(`Option "${o.text}" in "${key}" ${L} is longer than 20 characters and will be shortened on WhatsApp buttons`);
          else if (o.text.length > 24) warnings.push(`Option "${o.text}" in "${key}" ${L} is longer than 24 characters and will be shortened on WhatsApp lists`);
        });
        if (text.length > 1024) warnings.push(`Question "${key}" ${L}: text is longer than 1024 characters and will be cut on WhatsApp`);
        nodes[key] = { nodeType: 'message', text, isEnd, options };
      }

      if (type === 'products') {
        const products = (Array.isArray(n.products) ? n.products : []).map((p) => ({
          image: str(p?.image, 2000), title: str(p?.title, 120), description: str(p?.description, 900),
          buttonText: str(p?.buttonText, 20) || 'View', redirectUrl: str(p?.redirectUrl, 2000),
        }));
        if (!text) errors.push(`Products node "${key}" ${L} needs a heading text`);
        if (!products.length) errors.push(`Products node "${key}" ${L} needs at least one card`);
        if (products.length > LIMITS.cards) errors.push(`Products node "${key}" ${L} has ${products.length} cards (max ${LIMITS.cards} per node on WhatsApp)`);
        products.forEach((p) => {
          if (!p.title) errors.push(`A card in "${key}" ${L} is missing a title`);
          if (p.image && !URL_RE.test(p.image)) errors.push(`Card "${p.title}" in "${key}" ${L} has an invalid image link`);
          if (p.redirectUrl && !URL_RE.test(p.redirectUrl)) errors.push(`Card "${p.title}" in "${key}" ${L} has an invalid button link`);
          if (!p.redirectUrl) warnings.push(`Card "${p.title}" in "${key}" ${L} has no button link, so it is sent as a plain picture/text`);
        });
        nodes[key] = { nodeType: 'products', text, isEnd: false, products, productsNext: strOrNull(n.productsNext) };
      }

      if (type === 'form') {
        const seen = new Set();
        const fields = [];
        const raw = Array.isArray(n.formFields) ? n.formFields : [];
        if (!text) errors.push(`Form node "${key}" ${L} needs an intro text`);
        if (!raw.length) errors.push(`Form node "${key}" ${L} needs at least one field`);
        if (raw.length > LIMITS.fields) errors.push(`Form node "${key}" ${L} has ${raw.length} fields (max ${LIMITS.fields}; each one is a WhatsApp message)`);
        for (const f of raw) {
          const fKey = str(f?.key, 40);
          const label = str(f?.label, 200);
          const fieldType = FIELD_TYPES.includes(f?.fieldType) ? f.fieldType : (f?.fieldType ? null : 'text');
          if (!fKey || !label) { errors.push(`A field in form "${key}" ${L} is missing a key or label`); continue; }
          if (!FIELD_KEY_RE.test(fKey)) { errors.push(`Field key "${fKey}" in form "${key}" ${L} must start with a letter and use only letters, numbers and "_"`); continue; }
          if (!fieldType) { errors.push(`Field "${label}" in form "${key}" ${L} has an unknown type "${f.fieldType}"`); continue; }
          if (seen.has(fKey)) { errors.push(`Form "${key}" ${L} has a duplicate field key "${fKey}"`); continue; }
          const options = fieldType === 'select' ? (Array.isArray(f.options) ? f.options : []).map((o) => str(o, 100)).filter(Boolean) : [];
          if (fieldType === 'select') {
            if (!options.length) errors.push(`Dropdown "${label}" in form "${key}" ${L} needs at least one choice`);
            if (options.length > LIMITS.selectChoices) errors.push(`Dropdown "${label}" in form "${key}" ${L} has ${options.length} choices (max ${LIMITS.selectChoices} on WhatsApp)`);
            if (new Set(options).size !== options.length) errors.push(`Dropdown "${label}" in form "${key}" ${L} has duplicate choices`);
          }
          let showIf = null;
          if (f.showIf && f.showIf.field) {
            const dep = fields.find((x) => x.key === f.showIf.field);
            if (!dep) errors.push(`Field "${label}" in form "${key}" ${L} depends on "${f.showIf.field}", which must be an earlier field in the same form`);
            else if (dep.fieldType !== 'select') errors.push(`Field "${label}" in form "${key}" ${L} can only depend on a dropdown field`);
            else if (!f.showIf.equals) errors.push(`Field "${label}" in form "${key}" ${L} has a "show if" with no value`);
            else if (!dep.options.includes(String(f.showIf.equals))) errors.push(`Field "${label}" in form "${key}" ${L}: "${f.showIf.equals}" is not one of ${dep.label}'s choices`);
            else showIf = { field: f.showIf.field, equals: String(f.showIf.equals) };
          }
          seen.add(fKey);
          fields.push({ key: fKey, label, fieldType, required: !!f.required, placeholder: str(f.placeholder, 100), options, showIf });
        }
        nodes[key] = {
          nodeType: 'form', text, isEnd: false, formFields: fields,
          formSubmitLabel: str(n.formSubmitLabel, 20) || 'Submit',
          formSuccessText: str(n.formSuccessText, 500),
          formNext: strOrNull(n.formNext),
        };
      }

      if (type === 'steps') {
        const steps = (Array.isArray(n.steps) ? n.steps : []).map((s) => ({ image: str(s?.image, 2000), title: str(s?.title, 120), desc: str(s?.desc, 800) }));
        if (!text) errors.push(`Steps node "${key}" ${L} needs a heading text`);
        if (!steps.length) errors.push(`Steps node "${key}" ${L} needs at least one step`);
        if (steps.length > LIMITS.steps) errors.push(`Steps node "${key}" ${L} has ${steps.length} steps (max ${LIMITS.steps})`);
        steps.forEach((s, i) => {
          if (!s.title) errors.push(`Step ${i + 1} in "${key}" ${L} is missing a title`);
          if (s.image && !URL_RE.test(s.image)) errors.push(`Step ${i + 1} in "${key}" ${L} has an invalid image link`);
        });
        const closingImage = str(n.closingImage, 2000);
        if (closingImage && !URL_RE.test(closingImage)) errors.push(`The closing image of "${key}" ${L} is not a valid link`);
        nodes[key] = {
          nodeType: 'steps', text, isEnd: false, steps, stepsNext: strOrNull(n.stepsNext),
          closingTitle: str(n.closingTitle, 120), closingMessage: str(n.closingMessage, 800), closingImage,
        };
      }
    }

    const start = str(lf.start, 40);
    if (!Object.keys(nodes).length) errors.push(`The ${lang} flow has no questions`);
    else if (!start || !nodes[start]) errors.push(`The start node "${start}" ${L} does not exist`);
    else if (nodes[start].nodeType === 'message' && nodes[start].isEnd) errors.push(`The start node "${start}" ${L} is an ending message, so the bot would stop immediately. Pick a real first question as the start.`);

    // every reference must exist
    for (const [key, n] of Object.entries(nodes)) {
      const refs = [
        ...(n.options || []).map((o) => ['Option "' + o.text + '"', o.next]),
        ['"Continue"', n.productsNext], ['"After submit"', n.formNext], ['"After the last step"', n.stepsNext],
      ];
      for (const [what, ref] of refs) if (ref && !nodes[ref]) errors.push(`${what} in "${key}" ${L} points to a missing node "${ref}"`);
    }

    // unreachable nodes: warn (harmless, usually a leftover)
    if (start && nodes[start]) {
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length) {
        const n = nodes[stack.pop()];
        const next = [...(n.options || []).map((o) => o.next), n.productsNext, n.formNext, n.stepsNext].filter(Boolean);
        for (const k of next) if (nodes[k] && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
      const lost = Object.keys(nodes).filter((k) => !seen.has(k));
      if (lost.length) warnings.push(`${lost.length} node(s) in ${lang} can never be reached from the start: ${lost.slice(0, 8).join(', ')}${lost.length > 8 ? '…' : ''}`);
    }

    out[lang] = { start, questions: nodes };
  }

  if (Array.isArray(languages) && languages.length) {
    for (const l of languages) if (!out[l]) errors.push(`Language "${l}" is selected for this chat flow but has no flow yet`);
  }
  return { flow: out, errors, warnings };
}

module.exports = { sanitizeFlow, NODE_TYPES, FIELD_TYPES, LIMITS, LANG_RE };
