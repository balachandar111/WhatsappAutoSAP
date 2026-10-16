const XLSX = require("xlsx");

/*
|--------------------------------------------------------------------------
| Excel <-> Flow conversion
|--------------------------------------------------------------------------
| Lets an Admin build (or bulk-edit) a chatbot's question tree in a
| spreadsheet instead of clicking through the flow builder node-by-node,
| then import it in one shot. Mirrors the exact shape validated by
| chatbotController.validateFlow() / models/Chatbot.js.
|
| Workbook layout (one row per "thing"; several sheets, joined by
| Language + NodeKey):
|
|   Instructions  -> plain-English cheat sheet, ignored on import
|   Nodes         -> one row per question node (base info)
|   Options       -> one row per option on a "message" node
|   Products      -> one row per product card on a "products" node
|   Steps         -> one row per instruction step on a "steps" node
|   FormFields    -> one row per field on a "form" node
|
| Row order within a NodeKey is preserved (Options/Products/Steps/
| FormFields all render in the order they appear in the sheet).
*/

const NODE_TYPES = ["message", "products", "form", "steps"];
const FIELD_TYPES = ["text", "number", "tel", "email", "date", "textarea", "file", "select"];

// Options / ShowIfField / ShowIfEquals cells accept comma, semicolon, or
// pipe as a separator, since Excel autocorrect and copy-pasted lists use
// all three interchangeably.
const splitList = (v) =>
  clean(v)
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);

const truthy = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return ["yes", "y", "true", "1"].includes(s);
};

const clean = (v) => (v === undefined || v === null ? "" : String(v).trim());

function slugifyKey(label, existingKeys) {
  let base = (label || "field")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "");
  if (!base) base = "field";
  let key = base;
  let i = 2;
  while (existingKeys.includes(key)) key = `${base}_${i++}`;
  return key;
}

/*
|--------------------------------------------------------------------------
| parseFlowWorkbook(buffer)
|--------------------------------------------------------------------------
| Returns { flow, error }. `flow` matches the shape saved by the Flow
| Builder UI ( { [language]: { start, questions: { [key]: node } } } );
| `error` is a human-readable string (row-referenced where possible) if the
| sheet is malformed, in which case `flow` is null.
*/
function parseFlowWorkbook(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (e) {
    return { flow: null, error: "Could not read the file — please upload a valid .xlsx or .xls file" };
  }

  const sheet = (name) => {
    const ws = workbook.Sheets[name];
    return ws ? XLSX.utils.sheet_to_json(ws, { defval: "" }) : null;
  };

  const nodeRows = sheet("Nodes");
  if (!nodeRows) {
    return { flow: null, error: 'Missing a "Nodes" sheet. Download the template to see the expected format.' };
  }
  if (!nodeRows.length) {
    return { flow: null, error: 'The "Nodes" sheet has no data rows.' };
  }

  const optionRows = sheet("Options") || [];
  const productRows = sheet("Products") || [];
  const stepRows = sheet("Steps") || [];
  const formFieldRows = sheet("FormFields") || [];

  // flow[lang] = { start, questions: {}, __startFlagged: bool }
  const flow = {};
  const ensureLang = (lang) => {
    if (!flow[lang]) flow[lang] = { start: "", questions: {} };
    return flow[lang];
  };

  for (let i = 0; i < nodeRows.length; i++) {
    const row = nodeRows[i];
    const rowNum = i + 2; // +1 for header row, +1 for 1-based
    const lang = clean(row.Language).toLowerCase() || "english";
    const key = clean(row.NodeKey);
    if (!key) {
      return { flow: null, error: `Nodes sheet, row ${rowNum}: NodeKey is required` };
    }
    let nodeType = clean(row.NodeType).toLowerCase() || "message";
    if (!NODE_TYPES.includes(nodeType)) {
      return {
        flow: null,
        error: `Nodes sheet, row ${rowNum} (${key}): NodeType must be one of ${NODE_TYPES.join(", ")}`,
      };
    }

    const lf = ensureLang(lang);
    if (lf.questions[key]) {
      return { flow: null, error: `Nodes sheet, row ${rowNum}: duplicate NodeKey "${key}" for language "${lang}"` };
    }

    const base = { nodeType, text: clean(row.Text), isEnd: false };
    let node;
    if (nodeType === "message") {
      node = { ...base, isEnd: truthy(row.IsEnd), options: [] };
    } else if (nodeType === "products") {
      node = { ...base, products: [], productsNext: clean(row.ProductsNext) || null };
    } else if (nodeType === "steps") {
      node = { ...base, steps: [], stepsNext: clean(row.StepsNext) || null };
    } else {
      node = {
        ...base,
        formFields: [],
        formSubmitLabel: clean(row.FormSubmitLabel) || "Submit",
        formNext: clean(row.FormNext) || null,
      };
    }
    lf.questions[key] = node;

    if (truthy(row.IsStart)) {
      if (lf.start) {
        return { flow: null, error: `Nodes sheet: more than one node is marked IsStart=yes for language "${lang}"` };
      }
      lf.start = key;
    }
  }

  // default start = first node row seen per language, if none flagged.
  // Prefer the first row that's actually an askable "message" node (not
  // marked IsEnd) — otherwise a sheet whose first row happens to be a
  // closing/"Thank you…" node would silently become the start, which is
  // how a Tamil bot ended up opening on the goodbye message instead of Q1.
  for (const [lang, lf] of Object.entries(flow)) {
    if (lf.start) continue;
    const keys = Object.keys(lf.questions);
    const askableKey = keys.find((k) => {
      const n = lf.questions[k];
      return (n.nodeType || "message") === "message" && !n.isEnd;
    });
    lf.start = askableKey || keys[0];
  }

  const findNode = (lang, key, sheetName, rowNum) => {
    const lf = flow[lang];
    if (!lf || !lf.questions[key]) {
      throw new Error(`${sheetName} sheet, row ${rowNum}: NodeKey "${key}" (language "${lang}") not found in Nodes sheet`);
    }
    return lf.questions[key];
  };

  try {
    optionRows.forEach((row, i) => {
      const rowNum = i + 2;
      const lang = clean(row.Language).toLowerCase() || "english";
      const key = clean(row.NodeKey);
      if (!key) return; // skip blank filler rows
      const node = findNode(lang, key, "Options", rowNum);
      if (node.nodeType !== "message") {
        throw new Error(`Options sheet, row ${rowNum}: NodeKey "${key}" is not a "message" node`);
      }
      const label = clean(row.Label) || String.fromCharCode(65 + node.options.length);
      const text = clean(row.Text);
      if (!text) throw new Error(`Options sheet, row ${rowNum}: Text is required`);
      node.options.push({ label, text, next: clean(row.Next) || "", url: clean(row.Url) || "", handoff: clean(row.Handoff).toLowerCase() === "commerce" ? "commerce" : "" });
    });

    productRows.forEach((row, i) => {
      const rowNum = i + 2;
      const lang = clean(row.Language).toLowerCase() || "english";
      const key = clean(row.NodeKey);
      if (!key) return;
      const node = findNode(lang, key, "Products", rowNum);
      if (node.nodeType !== "products") {
        throw new Error(`Products sheet, row ${rowNum}: NodeKey "${key}" is not a "products" node`);
      }
      const title = clean(row.Title);
      if (!title) throw new Error(`Products sheet, row ${rowNum}: Title is required`);
      node.products.push({
        image: clean(row.Image),
        title,
        description: clean(row.Description),
        buttonText: clean(row.ButtonText) || "View",
        redirectUrl: clean(row.RedirectUrl),
      });
    });

    stepRows.forEach((row, i) => {
      const rowNum = i + 2;
      const lang = clean(row.Language).toLowerCase() || "english";
      const key = clean(row.NodeKey);
      if (!key) return;
      const node = findNode(lang, key, "Steps", rowNum);
      if (node.nodeType !== "steps") {
        throw new Error(`Steps sheet, row ${rowNum}: NodeKey "${key}" is not a "steps" node`);
      }
      const title = clean(row.Title);
      if (!title) throw new Error(`Steps sheet, row ${rowNum}: Title is required`);
      node.steps.push({ image: clean(row.Image), title, desc: clean(row.Description) });
    });

    formFieldRows.forEach((row, i) => {
      const rowNum = i + 2;
      const lang = clean(row.Language).toLowerCase() || "english";
      const key = clean(row.NodeKey);
      if (!key) return;
      const node = findNode(lang, key, "FormFields", rowNum);
      if (node.nodeType !== "form") {
        throw new Error(`FormFields sheet, row ${rowNum}: NodeKey "${key}" is not a "form" node`);
      }
      const label = clean(row.Label);
      if (!label) throw new Error(`FormFields sheet, row ${rowNum}: Label is required`);
      const fieldType = clean(row.FieldType).toLowerCase() || "text";
      if (!FIELD_TYPES.includes(fieldType)) {
        throw new Error(`FormFields sheet, row ${rowNum}: FieldType must be one of ${FIELD_TYPES.join(", ")}`);
      }
      const existingKeys = node.formFields.map((f) => f.key);
      const fieldKey = clean(row.FieldKey) || slugifyKey(label, existingKeys);

      let options = [];
      if (fieldType === "select") {
        options = splitList(row.Options);
        if (!options.length) {
          throw new Error(`FormFields sheet, row ${rowNum}: "select" fields need at least one choice in Options (comma-separated, e.g. "Online, Offline")`);
        }
      }

      let showIf = null;
      const showIfField = clean(row.ShowIfField);
      if (showIfField) {
        const showIfEquals = clean(row.ShowIfEquals);
        if (!showIfEquals) {
          throw new Error(`FormFields sheet, row ${rowNum}: ShowIfField is set but ShowIfEquals is empty`);
        }
        showIf = { field: showIfField, equals: showIfEquals };
      }

      node.formFields.push({
        key: fieldKey,
        label,
        fieldType,
        required: truthy(row.Required),
        placeholder: clean(row.Placeholder),
        options,
        showIf,
      });
    });
  } catch (e) {
    return { flow: null, error: e.message };
  }

  // strip the internal-only helper keys before returning
  const cleanedFlow = {};
  for (const [lang, lf] of Object.entries(flow)) {
    cleanedFlow[lang] = { start: lf.start, questions: lf.questions };
  }

  return { flow: cleanedFlow, error: null };
}

/*
|--------------------------------------------------------------------------
| flowToWorkbookBuffer(flow, { instructions })
|--------------------------------------------------------------------------
| Serializes a flow object (same shape produced above) back into the same
| 5-sheet layout, so an Admin can export their current bot, edit it in bulk
| (Excel/Google Sheets), and re-import it. When `flow` is empty, an
| illustrative sample flow is used instead (see buildSampleFlow below) —
| this doubles as the downloadable starter template.
*/
function flowToWorkbookBuffer(flow) {
  const nodesRows = [];
  const optionRows = [];
  const productRows = [];
  const stepRows = [];
  const formFieldRows = [];

  for (const [language, lf] of Object.entries(flow || {})) {
    const questions = lf.questions || {};
    for (const [key, rawNode] of Object.entries(questions)) {
      const node = rawNode.toJSON ? rawNode.toJSON() : rawNode;
      const nodeType = node.nodeType || "message";
      nodesRows.push({
        Language: language,
        NodeKey: key,
        NodeType: nodeType,
        Text: node.text || "",
        IsStart: lf.start === key ? "yes" : "no",
        IsEnd: nodeType === "message" && node.isEnd ? "yes" : "no",
        ProductsNext: nodeType === "products" ? node.productsNext || "" : "",
        StepsNext: nodeType === "steps" ? node.stepsNext || "" : "",
        FormNext: nodeType === "form" ? node.formNext || "" : "",
        FormSubmitLabel: nodeType === "form" ? node.formSubmitLabel || "Submit" : "",
      });

      (node.options || []).forEach((o) =>
        optionRows.push({ Language: language, NodeKey: key, Label: o.label, Text: o.text, Next: o.next || "", Url: o.url || "", Handoff: o.handoff || "" })
      );
      (node.products || []).forEach((p) =>
        productRows.push({
          Language: language,
          NodeKey: key,
          Image: p.image || "",
          Title: p.title || "",
          Description: p.description || "",
          ButtonText: p.buttonText || "View",
          RedirectUrl: p.redirectUrl || "",
        })
      );
      (node.steps || []).forEach((s) =>
        stepRows.push({ Language: language, NodeKey: key, Image: s.image || "", Title: s.title || "", Description: s.desc || "" })
      );
      (node.formFields || []).forEach((f) =>
        formFieldRows.push({
          Language: language,
          NodeKey: key,
          FieldKey: f.key || "",
          Label: f.label || "",
          FieldType: f.fieldType || "text",
          Required: f.required ? "yes" : "no",
          Placeholder: f.placeholder || "",
          Options: (f.options || []).join(", "),
          ShowIfField: f.showIf?.field || "",
          ShowIfEquals: f.showIf?.equals || "",
        })
      );
    }
  }

  return buildWorkbookBuffer({ nodesRows, optionRows, productRows, stepRows, formFieldRows });
}

const INSTRUCTIONS_ROWS = [
  { Sheet: "Nodes", "What it's for": "One row per question node. Every node your bot can show goes here first." },
  { Sheet: "", "What it's for": 'NodeKey = a short unique name for the node, e.g. "Q1" (this is how other sheets refer to it).' },
  { Sheet: "", "What it's for": "NodeType = message (question + tappable options), products, steps, or form." },
  { Sheet: "", "What it's for": 'IsStart = "yes" on exactly one node per language — that\'s the first message shown.' },
  { Sheet: "", "What it's for": 'IsEnd = "yes" on a message node with no options — a final reply, nothing after it.' },
  { Sheet: "", "What it's for": "ProductsNext / StepsNext / FormNext = NodeKey to continue to afterwards (leave blank to end there)." },
  { Sheet: "", "What it's for": "" },
  { Sheet: "Options", "What it's for": 'One row per tappable option on a "message" node. Next = NodeKey it leads to (blank = ends the chat there).' },
  { Sheet: "", "What it's for": "Url is optional — an external link (website, YouTube, ...) sent to the customer in WhatsApp when they tap the option." },
  { Sheet: "", "What it's for": 'Handoff is optional — type "commerce" to pass the customer to your ordering bot (products, cart, checkout) when they tap the option.' },
  { Sheet: "", "What it's for": "" },
  { Sheet: "Products", "What it's for": 'One row per product card on a "products" node. Image should be a direct image URL.' },
  { Sheet: "", "What it's for": "" },
  { Sheet: "Steps", "What it's for": 'One row per instruction step on a "steps" node, shown in the order listed here.' },
  { Sheet: "", "What it's for": "" },
  { Sheet: "FormFields", "What it's for": 'One row per field on a "form" node. FieldType: text, number, tel, email, date, textarea, file, select.' },
  { Sheet: "", "What it's for": 'Required = "yes"/"no". FieldKey can be left blank — it will be generated from the Label.' },
  { Sheet: "", "What it's for": 'Options: for FieldType=select only — the dropdown choices, comma-separated, e.g. "Online, Offline".' },
  { Sheet: "", "What it's for": 'ShowIfField / ShowIfEquals: optional — only show this field when an earlier field (by FieldKey) equals a value, e.g. ShowIfField="delivery_mode", ShowIfEquals="Online".' },
  { Sheet: "", "What it's for": "" },
  { Sheet: "Tip", "What it's for": "Delete the example rows and add your own — keep the header row on every sheet." },
];

function buildWorkbookBuffer({ nodesRows, optionRows, productRows, stepRows, formFieldRows }) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(INSTRUCTIONS_ROWS), "Instructions");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(nodesRows), "Nodes");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(optionRows), "Options");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(productRows), "Products");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(stepRows), "Steps");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(formFieldRows), "FormFields");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

/*
|--------------------------------------------------------------------------
| buildTemplateWorkbookBuffer()
|--------------------------------------------------------------------------
| A ready-to-edit sample: a small but complete 3-node flow (message ->
| products -> form) so an Admin can see exactly how the sheets relate to
| each other, then overwrite it with their own content.
*/
function buildTemplateWorkbookBuffer() {
  const sampleFlow = {
    english: {
      start: "Q1",
      questions: {
        Q1: { nodeType: "message", text: "How can we help you today?", isEnd: false, options: [] },
        Q2: { nodeType: "products", text: "Here are some options:", products: [], productsNext: "Q3" },
        Q3: { nodeType: "form", text: "Leave your details and we'll get back to you:", formFields: [], formSubmitLabel: "Submit", formNext: null },
      },
    },
  };
  sampleFlow.english.questions.Q1.options = [
    { label: "A", text: "See products", next: "Q2", url: "" },
    { label: "B", text: "Talk to support", next: "Q3", url: "" },
  ];
  sampleFlow.english.questions.Q2.products = [
    {
      image: "https://example.com/images/product1.jpg",
      title: "Classic Snack Pack",
      description: "Our best-selling combo pack",
      buttonText: "View on website",
      redirectUrl: "https://example.com/products/classic-pack",
    },
  ];
  sampleFlow.english.questions.Q3.formFields = [
    { key: "customer_name", label: "Your name", fieldType: "text", required: true, placeholder: "" },
    { key: "phone_number", label: "Phone number", fieldType: "tel", required: true, placeholder: "" },
    {
      key: "delivery_mode",
      label: "Where did you purchase from?",
      fieldType: "select",
      required: false,
      placeholder: "",
      options: ["Online", "Offline"],
    },
    {
      key: "order_id",
      label: "Order ID",
      fieldType: "text",
      required: true,
      placeholder: "",
      showIf: { field: "delivery_mode", equals: "Online" },
    },
  ];

  return flowToWorkbookBuffer(sampleFlow);
}

module.exports = { parseFlowWorkbook, flowToWorkbookBuffer, buildTemplateWorkbookBuffer };