/* Extend panel — nested pages for browsing, sheets for one-off actions. */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let S = null;

/* ---------- icons ---------- */
const SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  apps: SVG(`<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><path d="M17.25 13.5v7.5M13.5 17.25h7.5"/>`),
  agents: SVG(`<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01M9.5 17.5h5"/>`),
  models: SVG(`<path d="M12 4a4 4 0 0 0-4 4 3.5 3.5 0 0 0-1 6.8V16a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-1.2A3.5 3.5 0 0 0 16 8a4 4 0 0 0-4-4Z"/><path d="M12 19v2"/>`),
  whatsapp: SVG(`<path d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.6-3.9A8 8 0 1 1 20 11.5Z"/>`),
  mcp: SVG(`<path d="M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0V9ZM12 17v4"/>`),
  openai: SVG(`<circle cx="9" cy="12" r="4"/><path d="M13 12h8M17.5 12v3M20 12v2"/>`),
  env: SVG(`<path d="M5 7h14M5 12h14M5 17h14"/>`),
  skills: SVG(`<path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.8 6.6 19.7l1.2-6.1L3.3 9.4l6.1-.8Z"/>`),
  file: SVG(`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>`),
  memory: SVG(`<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/>`),
};
const CHEV = SVG(`<path d="M15 6l-6 6 6 6"/>`);
const TICK = SVG(`<path d="M20 6L9 17l-5-5"/>`);

/* ---------- data ---------- */
async function load() { S = await (await fetch("api/state", { credentials: "include" })).json(); }
async function act(action, data, opts = {}) {
  const r = await fetch("api/do", { method: "POST", credentials: "include",
    headers: { "content-type": "text/plain" }, body: JSON.stringify({ action, data }) });
  const j = await r.json().catch(() => ({ ok: false, msg: "تعذر الاتصال" }));
  toast(j.msg, !j.ok);
  if (j.ok) {
    closeSheet();
    await load();
    if (opts.back) history.back(); else render();
  }
  return j.ok;
}
async function gwAct(action, data) {
  const r = await fetch("api/gw", { method: "POST", credentials: "include",
    headers: { "content-type": "text/plain" }, body: JSON.stringify({ action, data }) });
  return await r.json().catch(() => ({ ok: false, msg: "تعذر الاتصال بالخادم" }));
}
/* Skill readiness comes from the CLI inside the gateway, so it loads separately
   from the config-backed state and is cached for the life of the page. */
let SK = null;
async function loadSkills(force) {
  if (SK && !force) return SK;
  SK = await gwAct("skills.list", force ? { force: true } : {});
  return SK;
}
const skillsReady = () => (SK?.skills || []).filter(s => s.eligible);
let tt;
function toast(msg, bad) {
  if (!msg) return;
  const t = $("#toast"); t.textContent = msg; t.className = "toast on" + (bad ? " bad" : "");
  clearTimeout(tt); tt = setTimeout(() => t.className = "toast", 2500);
}

/* ---------- bottom sheet ----------
   Used for one-off actions (short forms, confirmations) so they never cost the
   user a navigation step; anything browsable stays a real page with a URL. */
function closeSheet() {
  const s = $("#sheet");
  if (s.hidden) return;
  s.classList.remove("on");
  setTimeout(() => { s.hidden = true; s.innerHTML = ""; }, 180);
}
function sheet({ title, desc, body = "", primary, danger, onPrimary, onMount }) {
  const s = $("#sheet");
  s.hidden = false;
  s.innerHTML = `<div class="sheet-back" data-close></div>
    <div class="sheet-card" role="dialog" aria-modal="true">
      <div class="sheet-grab"></div>
      <h2 class="sheet-t">${esc(title)}</h2>
      ${desc ? `<p class="sheet-d">${esc(desc)}</p>` : ""}
      <div class="sheet-b">${body}</div>
      <div class="sheet-a">
        ${primary ? `<button class="btn${danger ? " danger" : ""}" id="sheet-ok">${esc(primary)}</button>` : ""}
        <button class="btn ghost" data-close>إلغاء</button>
      </div>
    </div>`;
  requestAnimationFrame(() => s.classList.add("on"));
  s.querySelectorAll("[data-close]").forEach(b => b.onclick = closeSheet);
  const ok = $("#sheet-ok");
  if (ok) ok.onclick = () => onPrimary?.(ok);
  // Sheets render outside #main, so wire their rows to the current route too.
  const route = resolve(location.hash.replace(/^#\/?/, ""));
  if (route) bind(s, route);
  onMount?.(s);
  const first = s.querySelector("input,textarea");
  if (first) setTimeout(() => first.focus(), 220);
}
const confirmSheet = (title, desc, primary, onYes) =>
  sheet({ title, desc, primary, danger: true, onPrimary: onYes });
/** fields: [{id,label,placeholder,ltr,hint,value,type}] */
function formSheet(title, desc, fields, primary, onSubmit) {
  sheet({ title, desc, primary,
    body: fields.map(f => `<label class="fl">${esc(f.label)}</label>
      ${f.multiline
        ? `<textarea id="${f.id}" rows="3" class="${f.ltr ? "ltr" : ""}" placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea>`
        : `<input type="${f.type || "text"}" id="${f.id}" class="${f.ltr ? "ltr" : ""}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.value || "")}">`}
      ${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ""}`).join(""),
    onPrimary: () => onSubmit(Object.fromEntries(fields.map(f => [f.id, $("#" + f.id).value.trim()]))) });
}

/* ---------- building blocks ---------- */
const grp = (rows) => `<div class="grp">${rows.join("") || `<div class="empty">لا يوجد شيء هنا</div>`}</div>`;
const sec = (heading, content, note) =>
  `<section class="sec">${heading ? `<h2 class="sec-h">${esc(heading)}</h2>` : ""}${content}${note ? `<p class="sec-n">${note}</p>` : ""}</section>`;
function row(o) {
  const tag = o.go || o.on ? "button" : "div";
  const attrs = [o.go ? `data-go="${esc(o.go)}"` : "", o.on ? `data-on="${esc(o.on)}"` : "",
    o.arg !== undefined ? `data-arg="${esc(o.arg)}"` : ""].join(" ");
  return `<${tag} class="r${o.icon ? " ind" : ""}${o.sel ? " sel" : ""}${!o.go && !o.on ? " static" : ""}" ${attrs}>
    ${o.icon ? `<span class="ic">${ICON[o.icon] || ""}</span>` : ""}
    <span class="tx"><span class="t" dir="auto">${esc(o.title)}</span>${o.desc ? `<span class="d" dir="auto">${esc(o.desc)}</span>` : ""}</span>
    ${o.value !== undefined ? `<span class="v ${o.ltr ? "ltr" : ""}">${esc(o.value)}</span>` : ""}
    ${o.sw !== undefined ? `<span class="sw${o.sw ? " on" : ""}"><i></i></span>` : ""}
    ${o.sel !== undefined ? `<span class="tick">${TICK}</span>` : ""}
    ${o.go ? `<span class="chev">${CHEV}</span>` : ""}
  </${tag}>`;
}
/** A choice screen: one question, options with a checkmark, saves on tap. */
function chooser(title, intro, options, current, onPick, crumb) {
  return { title, intro, crumb, render: () => grp(options.map(o =>
      row({ title: o.t, desc: o.d, sel: String(o.v) === String(current()), on: "pick", arg: o.v }))),
    handlers: { pick: (v) => onPick(v) } };
}
function chipList(items, emptyText, addLabel, onAdd, onRemove) {
  return `<div class="grp"><div class="chips">${items.length ? items.map(v =>
    `<span class="chip"><span class="ltr">${esc(v)}</span><button data-on="rm" data-arg="${esc(v)}">&times;</button></span>`).join("")
    : `<span class="v">${esc(emptyText)}</span>`}</div></div>
    ${grp([row({ title: addLabel, on: "add" })])}`;
}
const kb = (n) => n === null ? "غير موجود" : n < 1024 ? `${n} بايت` : `${Math.round(n / 1024)} كيلوبايت`;

/* ---------- markdown editor (EasyMDE, MIT, vendored under /assets/mde) ----------
   Styles headings/bold/lists inline as you type and renders a real preview, so
   no bespoke editor is needed here. */
let MDE = null;
function destroyEditor() {
  try { MDE?.toTextArea(); } catch {}
  MDE = null;
}
/** First strong character decides direction: memory logs are Arabic, AGENTS.md is not. */
const guessDir = (text) => {
  const m = String(text || "").match(/[\p{Script=Arabic}\p{Script=Latin}]/u);
  return m && /\p{Script=Arabic}/u.test(m[0]) ? "rtl" : "ltr";
};
const MDE_TOOLBAR = [
  { name: "bold", action: EasyMDE.toggleBold, className: "mdb-bold", title: "عريض" },
  { name: "italic", action: EasyMDE.toggleItalic, className: "mdb-italic", title: "مائل" },
  { name: "heading", action: EasyMDE.toggleHeadingSmaller, className: "mdb-head", title: "عنوان" },
  "|",
  { name: "list", action: EasyMDE.toggleUnorderedList, className: "mdb-list", title: "قائمة" },
  { name: "quote", action: EasyMDE.toggleBlockquote, className: "mdb-quote", title: "اقتباس" },
  { name: "link", action: EasyMDE.drawLink, className: "mdb-link", title: "رابط" },
];

/* Preview is a tab, not a toolbar toggle, so there is exactly one control for
   it and nothing can disagree about which mode is showing. EasyMDE only offers
   a toggle, so read its state and act only when the two differ. */
function setEditorTab(mode) {
  if (!MDE) return;
  const wantPreview = mode === "preview";
  if (MDE.isPreviewActive() !== wantPreview) MDE.togglePreview();
  // Nothing in preview is editable, so the formatting toolbar would only invite
  // taps that do nothing visible.
  document.querySelector(".EasyMDEContainer")?.classList.toggle("previewing", wantPreview);
  document.querySelectorAll(".mdtab").forEach((b) => {
    const on = (b.dataset.tab === "preview") === wantPreview;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
}
const editorTabs = () => `<div class="mdtabs" role="tablist">
  <button class="mdtab on" role="tab" aria-selected="true" data-tab="edit" data-on="tabEdit">تحرير</button>
  <button class="mdtab" role="tab" aria-selected="false" data-tab="preview" data-on="tabPreview">معاينة</button>
</div>`;
/* These files are written by the agent, and chat content reaches them — a group
   message quoted into MEMORY.md becomes preview HTML. Markdown allows raw HTML,
   so render through an allowlist: unknown elements are unwrapped to their text,
   script/style are dropped whole, and only http(s)/mailto/anchor URLs survive.
   Without this, anyone who can message the agent can run script in the panel. */
const PREVIEW_TAGS = new Set(["A","P","BR","HR","EM","STRONG","B","I","CODE","PRE","BLOCKQUOTE",
  "UL","OL","LI","H1","H2","H3","H4","H5","H6","IMG","TABLE","THEAD","TBODY","TR","TH","TD","DEL"]);
const SAFE_URL = /^(?:https?:\/\/|mailto:|#|\/)/i;
function sanitizePreview(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.body.querySelectorAll("script,style,iframe,object,embed,form").forEach(el => el.remove());
  for (const el of [...doc.body.querySelectorAll("*")]) {
    if (!PREVIEW_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
    for (const { name } of [...el.attributes]) {
      const keep = (el.tagName === "A" && name === "href")
        || (el.tagName === "IMG" && (name === "src" || name === "alt"));
      if (!keep) el.removeAttribute(name);
    }
    for (const attr of ["href", "src"]) {
      const v = el.getAttribute(attr);
      if (v !== null && !SAFE_URL.test(v.trim())) el.removeAttribute(attr);
    }
    if (el.tagName === "A") { el.setAttribute("rel", "noopener noreferrer"); el.setAttribute("target", "_blank"); }
  }
  return doc.body.innerHTML;
}

function mountEditor(el, content) {
  destroyEditor();
  MDE = new EasyMDE({
    element: el,
    initialValue: content || "",
    // Never let the editor fetch an icon font; this page must stay self-contained.
    autoDownloadFontAwesome: false,
    spellChecker: false,
    status: false,
    autofocus: false,
    direction: guessDir(content),
    placeholder: "الملف فارغ، اكتب فيه ما تشاء.",
    toolbar: MDE_TOOLBAR,
    previewClass: ["editor-preview", "md-preview"],
    renderingConfig: { sanitizerFunction: sanitizePreview },
  });
}

/* ---------- routes ---------- */
const PERM_T = { true: "بدون إذن", ask: "يطلب الإذن", false: "ممنوع" };
const permOf = v => v === "ask" ? "ask" : v === false ? "false" : "true";
const PERM_OPTS = [
  { v: "true", t: "يعمل بدون طلب إذن", d: "الأفضل للاستخدام اليومي" },
  { v: "ask", t: "يطلب إذنك كل مرة", d: "عندما تريد مراجعة كل إجراء" },
  { v: "false", t: "ممنوع", d: "يستطيع القراءة فقط دون تعديل" }];
const CURATED = ["gmail","google-drive","google-calendar","slack","github","notion","linear","dropbox","outlook"];

/** Config stores agent ids; every screen should show the name the user chose. */
const agentName = (id) => S.agents.find(a => a.id === id)?.name || id;
const modelName = (ref) => S.catalog.find(m => m.ref === ref || m.slug === String(ref || "").split("/").pop())?.name || ref || "—";
const thinkName = (v) => S.thinkingOptions.find(t => t.v === v)?.t || v;

/* MCP servers are added by pasting one URL. Streamable HTTP is the current
   transport, so SSE is offered only as a fallback for older servers. Auth
   belongs in a header or OAuth, never in the URL — see the warning below. */
function addMcpSheet(agentId) {
  sheet({
    title: "إضافة خادم MCP",
    desc: agentId ? "سيضاف لهذا الوكيل وحده." : "ألصق رابط الخادم فقط، وسنتولى الباقي.",
    primary: "إضافة",
    body: `<label class="fl">رابط الخادم</label>
      <input type="url" id="mu" class="ltr" placeholder="https://mcp.example.com/mcp" enterkeyhint="done">
      <p class="hint">تجد الرابط في صفحة الخدمة تحت اسم MCP Server URL.</p>
      ${grp([
        row({ title: "يحتاج تسجيل دخول (OAuth)", desc: "الأفضل: لا يحفظ أي مفتاح عندك", sw: false, on: "oauth" }),
        row({ title: "خادم قديم (SSE)", desc: "جربه فقط إذا فشل الاتصال", sw: false, on: "sse" }),
      ])}
      <div id="tokbox"><label class="fl">مفتاح الوصول (اختياري)</label>
      <input type="text" id="mt" class="ltr" placeholder="sk-...">
      <p class="hint">يحفظ كترويسة Authorization. إذا كان مفتاحك مدمجا داخل الرابط فاتركه مكانه.</p></div>`,
    onPrimary: () => act("mcp.add", {
      url: $("#mu").value.trim(),
      token: $("#mt")?.value.trim() || "",
      oauth: !!document.querySelector('[data-on="oauth"] .sw.on'),
      legacySse: !!document.querySelector('[data-on="sse"] .sw.on'),
      agentId: agentId || null,
    }),
    onMount: (s) => s.querySelectorAll('[data-on="oauth"],[data-on="sse"]').forEach(b =>
      b.onclick = () => {
        const on = b.querySelector(".sw").classList.toggle("on");
        // A static key is ignored once OAuth is on, so hide it rather than
        // letting the user type something that will be silently dropped.
        if (b.dataset.on === "oauth") s.querySelector("#tokbox").hidden = on;
      }),
  });
}

function addAgentSheet() {
  formSheet("وكيل جديد", "لكل وكيل ملفاته وذاكرته الخاصة.", [
    { id: "agname", label: "الاسم", placeholder: "مثال: وكيل الدعم" },
    { id: "agid", label: "المعرف", placeholder: "support", ltr: true, hint: "حروف إنجليزية صغيرة وشرطات فقط، ولا يمكن تغييره لاحقا." },
  ], "إنشاء", (v) => act("agent.create", { id: v.agid, name: v.agname }));
}

const R = {
  "": { crumb: "لوحة التحكم", title: "لوحة التحكم", intro: "كل ما تحتاجه لإدارة وكلائك، بدون سطر أوامر.",
    render: () => grp([
      row({ icon: "agents", title: "الوكلاء", value: `${S.agents.length}`, go: "agents" }),
      row({ icon: "models", title: "النماذج", value: modelName(S.defaultModel), go: "models" }),
      row({ icon: "apps", title: "التطبيقات", value: S.apps.length ? `${S.apps.length}` : "لا يوجد", go: "apps" }),
      row({ icon: "skills", title: "المهارات", value: SK ? `${skillsReady().length}` : "", go: "skills" }),
      row({ icon: "whatsapp", title: "واتساب", value: { pairing: "بموافقتك", allowlist: "أرقام محددة", open: "مفتوح للجميع" }[S.whatsapp.dmPolicy], go: "whatsapp" }),
      row({ icon: "mcp", title: "خوادم MCP", value: S.mcp.length ? `${S.mcp.length}` : "لا يوجد", go: "mcp" }),
      row({ icon: "openai", title: "ربط OpenAI", go: "openai" }),
      row({ icon: "env", title: "متغيرات البيئة", value: S.env.length ? `${S.env.length}` : "لا يوجد", go: "env" }),
    ]) },

  apps: { crumb: "التطبيقات", title: "التطبيقات", intro: "التطبيقات التي يستطيع الوكيل استخدامها، وصلاحية كل تطبيق.",
    render: () => {
      const drift = S.unmanaged.length ? sec("تحتاج انتباهك",
        `<div class="note warn"><b>توجد تطبيقات مثبتة في كودكس ولم تضبط هنا</b>
         ${esc(S.unmanaged.join("، "))} — ستظل تطلب الإذن في كل مرة حتى تضيفها.</div>
         ${grp(S.unmanaged.map(u => row({ title: `أضف ${u}`, on: "quick", arg: u })))}`) : "";
      const all = S.allowAll ? sec("", `<div class="note warn"><b>خيار «السماح لكل التطبيقات» مفعل</b>
        التطبيقات التي تدخل بهذه الطريقة لا تلتزم بالصلاحية وتظل تطلب الإذن.</div>
        ${grp([row({ title: "إيقاف هذا الخيار", on: "allowall" })])}`) : "";
      return drift + all +
        sec("التطبيقات المضافة", grp(S.apps.map(a => row({ title: a.id, ltr: 1, value: PERM_T[permOf(a.perm)], go: "apps/" + a.id })))) +
        sec("", grp([row({ title: "إضافة تطبيق", on: "new" })]),
          "التطبيقات مشتركة بين جميع الوكلاء، ولا يمكن تخصيص تطبيق لوكيل واحد.");
    },
    handlers: {
      quick: (u) => act("app.add", { id: u, perm: "true" }),
      allowall: () => act("app.allowall", {}),
      new: () => {
        const avail = CURATED.filter(a => !S.apps.some(x => x.id === a));
        sheet({ title: "إضافة تطبيق", desc: "اختر التطبيق، ويمكنك تغيير صلاحيته لاحقا.",
          body: grp(avail.map(a => row({ title: a, ltr: 1, on: "pick", arg: a }))),
          onMount: (s) => s.querySelectorAll("[data-on=pick]").forEach(b =>
            b.onclick = () => act("app.add", { id: b.dataset.arg, perm: "true" })) });
      } } },

  agents: { crumb: "الوكلاء", title: "الوكلاء", intro: "لكل وكيل نموذج وملفات وذاكرة مستقلة.",
    render: () => sec("", grp(S.agents.map(a => row({ title: a.name,
      desc: a.isMain ? "الوكيل الرئيسي" : (a.description || a.id),
      value: modelName(a.model || S.defaultModel), go: "agents/" + a.id }))))
      + sec("", grp([row({ title: "إنشاء وكيل جديد", on: "new" })])),
    handlers: { new: addAgentSheet } },

  models: { crumb: "النماذج", title: "النماذج", intro: "النموذج هو عقل الوكيل، ومستوى التفكير يحدد مقدار تفكيره قبل الرد.",
    render: () => sec("الافتراضي", grp([
        row({ title: "النموذج", value: modelName(S.defaultModel), go: "models/default" }),
        row({ title: "مستوى التفكير", value: thinkName(S.defaultThinking), go: "thinking/default" }),
      ]), "تنطبق على كل وكيل ليس له إعداد خاص.")
      + sec("لكل وكيل", grp(S.agents.map(a => row({ title: a.name,
        value: a.model ? modelName(a.model) : "الافتراضي", go: "models/" + a.id })))) },

  "thinking/default": () => chooser("مستوى التفكير", "كلما ارتفع المستوى، زادت الدقة وقل السرعة.",
    S.thinkingOptions.map(t => ({ v: t.v, t: t.t, d: t.d })),
    () => S.defaultThinking, (v) => act("thinking.default", { level: v }, { back: true }), "مستوى التفكير"),

  whatsapp: { crumb: "واتساب", title: "واتساب", intro: "ثلاثة أسئلة تحدد سلوك الوكيل: من يراسله في الخاص، وفي أي مجموعات يعمل، ومن يستطيع تشغيله داخلها.",
    render: () => {
      const w = S.whatsapp;
      return sec("المحادثات الخاصة", grp([
          row({ title: "من يستطيع مراسلته", value: { pairing: "بموافقتك", allowlist: "أرقام محددة", open: "الجميع" }[w.dmPolicy], go: "whatsapp/dm" }),
          row({ title: "الأرقام المسموح لها", value: w.allowFrom.length ? `${w.allowFrom.length}` : "لا يوجد", go: "whatsapp/dm-numbers" }),
        ]), "هذه القائمة للمحادثات الخاصة فقط، ولا علاقة لها بالمجموعات.")
      + sec("المجموعات", grp([
          row({ title: "في أي مجموعات يعمل", value: { open: "الجميع", allowlist: "مجموعات محددة", disabled: "لا يرد" }[w.groupPolicy], go: "whatsapp/groups" }),
          row({ title: "من يستطيع تشغيله داخلها", value: w.groupAllowFrom.length ? `${w.groupAllowFrom.length}` : "الجميع", go: "whatsapp/group-numbers" }),
          row({ title: "لا يرد إلا عند مناداته", sw: w.requireMention, on: "mention" }),
          row({ title: "الرد التلقائي", desc: "عند إيقافه، لن يرد إلا إذا قرر ذلك بنفسه", sw: w.autoReply, on: "auto" }),
        ]), "عند تفعيل المناداة، يقرأ بقية الرسائل كسياق فقط دون تدخل. ويجب تفعيل الرد التلقائي حتى تصل ردوده إلى المجموعة.")
      + sec("متقدم", grp([
          row({ title: "محادثتك مع نفسك", desc: "التحدث مع الوكيل من محادثتك الشخصية", sw: w.selfChatMode, on: "self" }),
          row({ title: "سرعة الرد", value: { 0: "فوري", 2000: "متوازن", 5000: "هادئ" }[w.debounceMs] || "متوازن", go: "whatsapp/speed" }),
          row({ title: "إعادة ربط واتساب", go: "whatsapp/reconnect" }),
        ]));
    },
    handlers: {
      mention: () => act("wa.save", { requireMention: !S.whatsapp.requireMention }),
      self: () => act("wa.save", { selfChatMode: !S.whatsapp.selfChatMode }),
      auto: () => act("wa.autoreply", { on: !S.whatsapp.autoReply }),
    } },

  "whatsapp/dm": () => chooser("من يستطيع مراسلة الوكيل في الخاص؟", "",
    [{ v: "pairing", t: "أي شخص، بعد موافقتك", d: "عند وصول رسالة من شخص جديد يصلك طلب للموافقة" },
     { v: "allowlist", t: "أرقام محددة فقط", d: "الأرقام الموجودة في القائمة فقط" },
     { v: "open", t: "الجميع بدون قيود", d: "أي شخص يستطيع مراسلته، وهذا غير موصى به" }],
    () => S.whatsapp.dmPolicy, (v) => act("wa.save", { dmPolicy: v }, { back: true }), "المحادثات الخاصة"),

  "whatsapp/groups": () => chooser("في أي مجموعات يعمل الوكيل؟", "",
    [{ v: "allowlist", t: "مجموعات محددة فقط", d: "المجموعات التي تربطها بوكيل من صفحة الوكلاء" },
     { v: "open", t: "جميع المجموعات", d: "أي مجموعة يكون عضوا فيها" },
     { v: "disabled", t: "لا يرد في المجموعات إطلاقا", d: "المحادثات الخاصة فقط" }],
    () => S.whatsapp.groupPolicy, (v) => act("wa.save", { groupPolicy: v }, { back: true }), "المجموعات"),

  "whatsapp/dm-numbers": { crumb: "أرقام الخاص", title: "الأرقام المسموح لها",
    intro: "تنطبق على المحادثات الخاصة فقط.",
    render: () => chipList(S.whatsapp.allowFrom, "لا توجد أرقام", "إضافة رقم"),
    handlers: {
      add: () => formSheet("إضافة رقم", "للمحادثات الخاصة.",
        [{ id: "num", label: "الرقم", placeholder: "966500000000+", ltr: true, type: "tel" }], "إضافة",
        (v) => v.num && act("wa.save", { allowFrom: [...S.whatsapp.allowFrom, v.num] })),
      rm: (v) => act("wa.save", { allowFrom: S.whatsapp.allowFrom.filter(x => x !== v) }) } },

  "whatsapp/group-numbers": { crumb: "أرقام المجموعات", title: "من يستطيع تشغيله داخل المجموعات",
    intro: "إذا تركتها فارغة، يستطيع أي شخص في المجموعة تشغيله. وإذا أضفت أرقاما، فهم وحدهم من يستطيع ذلك، وتصل رسائل الباقين كسياق دون رد.",
    render: () => chipList(S.whatsapp.groupAllowFrom, "الجميع مسموح لهم", "إضافة رقم"),
    handlers: {
      add: () => formSheet("إضافة رقم", "يستطيع تشغيل الوكيل داخل المجموعات.",
        [{ id: "num", label: "الرقم", placeholder: "966500000000+", ltr: true, type: "tel" }], "إضافة",
        (v) => v.num && act("wa.save", { groupAllowFrom: [...S.whatsapp.groupAllowFrom, v.num] })),
      rm: (v) => act("wa.save", { groupAllowFrom: S.whatsapp.groupAllowFrom.filter(x => x !== v) }) } },

  "whatsapp/speed": () => chooser("سرعة الرد في المجموعات", "",
    [{ v: "2000", t: "متوازن", d: "ينتظر ثانيتين ويجمع الرسائل المتتابعة في رد واحد، وهو الأفضل للمجموعات" },
     { v: "0", t: "فوري", d: "يرد على كل رسالة على حدة، ويصبح بطيئا عند كثرة الرسائل" },
     { v: "5000", t: "هادئ", d: "ينتظر خمس ثوان، وهو مناسب للمجموعات كثيرة الرسائل" }],
    () => String(S.whatsapp.debounceMs), (v) => act("wa.debounce", { ms: Number(v) }, { back: true }), "سرعة الرد"),

  "whatsapp/reconnect": { crumb: "إعادة الربط", title: "إعادة ربط واتساب",
    render: () => `<div class="note">إذا توقف الوكيل عن الرد في واتساب، أعد الربط من هنا.</div>
      <ol class="steps" style="margin-top:20px"><li>اضغط على الزر بالأسفل.</li>
      <li>افتح واتساب في هاتفك ثم الأجهزة المرتبطة.</li><li>امسح الرمز الذي يظهر لك.</li></ol>
      <button class="btn" data-on="link">اطلب رمز الربط</button><div id="out"></div>`,
    handlers: { link: async (v, btn) => {
      btn.innerHTML = '<span class="spin"></span>'; btn.disabled = true;
      const j = await gwAct("wa.link", {});
      btn.textContent = "اطلب رمز الربط"; btn.disabled = false;
      $("#out").innerHTML = `<div class="note ${j.ok ? "" : "warn"}" style="margin-top:16px;word-break:break-all"><span class="ltr">${esc(j.msg || "")}</span></div>`;
    } } },

  skills: { crumb: "المهارات", title: "المهارات",
    intro: "المهارة تضيف للوكيل قدرة محددة، مثل قراءة البريد أو إنشاء الرسومات.",
    render: () => {
      if (!SK) return `<div class="loading"><span class="spin dark"></span> جاري تحميل المهارات...</div>`;
      if (!SK.ok) return `<div class="note warn">${esc(SK.msg || "تعذر تحميل قائمة المهارات")}</div>`;
      const on = SK.skills.filter(s => s.eligible && S.skillEntries[s.name] !== false);
      const off = SK.skills.filter(s => S.skillEntries[s.name] === false);
      const need = SK.skills.filter(s => !s.eligible && !s.platformIncompatible && S.skillEntries[s.name] !== false);
      const line = (s) => row({ title: s.name, ltr: 1, desc: s.description,
        value: s.missing.length ? "غير مكتملة" : "", go: "skills/" + s.name });
      return sec("مهارات جاهزة", grp(on.map(line)), "هذه المهارات متاحة للوكيل الآن.")
        + (need.length ? sec("تحتاج إعدادا", grp(need.slice(0, 12).map(line)),
            `${need.length} مهارة تحتاج برامج أو مفاتيح غير متوفرة على الخادم.`) : "")
        + (off.length ? sec("مهارات موقوفة", grp(off.map(line))) : "")
        + sec("", grp([row({ title: "إضافة مهارة جديدة", on: "add" }),
            row({ title: "تحديث القائمة", on: "refresh" })]));
    },
    mounted: async () => { if (!SK) { await loadSkills(); render(); } },
    handlers: {
      refresh: async (v, btn) => { btn.innerHTML = '<span class="spin dark"></span>'; await loadSkills(true); render(); },
      add: () => sheet({ title: "إضافة مهارة", desc: "ابحث في ClawHub ثم اضغط على المهارة لتثبيتها.",
        body: `<div class="addrow"><input type="search" id="sq" placeholder="مثال: calendar" enterkeyhint="search">
          <button class="mini" id="sgo">بحث</button></div><div id="sres"></div>`,
        onMount: (s) => {
          const go = async () => {
            const q = s.querySelector("#sq").value.trim();
            const out = s.querySelector("#sres");
            out.innerHTML = `<div class="loading"><span class="spin dark"></span> جاري البحث...</div>`;
            const j = await gwAct("skills.search", { query: q });
            if (!j.ok) return out.innerHTML = `<div class="note warn">${esc(j.msg)}</div>`;
            if (!j.results.length) return out.innerHTML = `<div class="empty">لا توجد نتائج</div>`;
            out.innerHTML = grp(j.results.map(r => row({ title: r.name, ltr: 1,
              desc: r.summary, value: r.official ? "رسمية" : "", on: "pick", arg: r.ref })));
            out.querySelectorAll("[data-on=pick]").forEach(b => b.onclick = async () => {
              b.disabled = true; b.querySelector(".tx").innerHTML = `<span class="t">جاري التثبيت...</span>`;
              const res = await gwAct("skills.install", { ref: b.dataset.arg });
              toast(res.msg, !res.ok);
              if (res.ok) { await loadSkills(true); closeSheet(); render(); } else b.disabled = false;
            });
          };
          s.querySelector("#sgo").onclick = go;
          s.querySelector("#sq").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } };
        } }) } },

  mcp: { crumb: "خوادم MCP", title: "خوادم MCP", intro: "خوادم تمنح الوكيل قدرات إضافية من خدمات خارجية.",
    render: () => {
      const line = (m) => row({ title: m.name, ltr: 1,
        desc: m.agents ? "لـ " + m.agents.map(agentName).join("، ")
          : (m.oauth ? "يتطلب تسجيل دخول" : "يصل إليه كل الوكلاء"),
        value: m.enabled ? "" : "موقوف", go: "mcp/" + m.name });
      const shared = S.mcp.filter(m => !m.agents);
      const scoped = S.mcp.filter(m => m.agents);
      return (shared.length ? sec("لجميع الوكلاء", grp(shared.map(line))) : "")
        + (scoped.length ? sec("مخصصة لوكيل معين", grp(scoped.map(line)),
            "هذه الخوادم لا تظهر إلا للوكلاء المذكورين.") : "")
        + (S.mcp.length ? "" : grp([]))
        + sec("", grp([row({ title: "إضافة خادم", on: "add" })]));
    },
    handlers: { add: () => addMcpSheet(null) } },

  openai: { crumb: "ربط OpenAI", title: "ربط OpenAI", intro: "عند انتهاء صلاحية تسجيل الدخول، يتوقف الوكيل عن الرد.",
    render: () => `<ol class="steps"><li>اضغط على «ابدأ» ليظهر لك رابط.</li><li>افتح الرابط وسجل دخولك.</li>
      <li>بعد الانتهاء سيحاول المتصفح فتح صفحة لا تعمل لديك، وهذا أمر طبيعي.</li>
      <li>انسخ الرابط كاملا من شريط العنوان وألصقه بالأسفل.</li></ol>
      <button class="btn" data-on="start">ابدأ</button>
      <div id="oaout" hidden><label class="fl">الرابط</label><div class="note ltr" id="oaurl" style="word-break:break-all"></div>
      <label class="fl">ألصق الرابط الذي وصلت إليه</label>
      <input type="url" id="oacb" placeholder="http://127.0.0.1:1455/auth/callback?code=..." class="ltr">
      <button class="btn" data-on="done">إكمال الربط</button></div>`,
    handlers: {
      start: async (v, btn) => { btn.innerHTML = '<span class="spin"></span>'; btn.disabled = true;
        const j = await gwAct("openai.start", {}); btn.textContent = "ابدأ"; btn.disabled = false;
        if (!j.ok) return toast(j.msg || "تعذر بدء العملية", true);
        $("#oaurl").textContent = j.url || ""; $("#oaout").hidden = false; },
      done: async (v, btn) => { const cb = $("#oacb").value.trim(); if (!cb) return;
        btn.innerHTML = '<span class="spin"></span>'; btn.disabled = true;
        const j = await gwAct("openai.complete", { callbackUrl: cb });
        btn.textContent = "إكمال الربط"; btn.disabled = false; toast(j.msg, !j.ok); } } },

  env: { crumb: "متغيرات البيئة", title: "متغيرات البيئة", intro: "مفاتيح الخدمات الخارجية. تحفظ على خادمك ولا تظهر لأحد.",
    render: () => sec("", grp(S.env.map(e => row({ title: e.key, ltr: 1, value: "••••••", on: "del", arg: e.key }))))
      + sec("", grp([row({ title: "إضافة متغير", on: "new" })]), "اضغط على أي متغير لحذفه."),
    handlers: {
      new: () => formSheet("متغير جديد", "", [
        { id: "ek", label: "الاسم", placeholder: "API_KEY", ltr: true },
        { id: "ev", label: "القيمة", ltr: true }], "حفظ",
        (v) => act("env.set", { key: v.ek, value: v.ev })),
      del: (k) => confirmSheet(`حذف ${k}؟`, "ستتوقف الخدمات التي تعتمد عليه.", "حذف",
        () => act("env.unset", { key: k })) } },
};

/* dynamic routes */
function resolve(p) {
  if (R[p]) return typeof R[p] === "function" ? R[p]() : R[p];
  const parts = p.split("/");
  const [head, arg, sub, ...rest] = parts;
  const tail = rest.join("/");

  if (head === "apps" && arg) {
    const a = S.apps.find(x => x.id === arg); if (!a) return null;
    return { crumb: arg, title: arg,
      render: () => sec("الصلاحية", grp(PERM_OPTS.map(o => row({ title: o.t, desc: o.d, sel: o.v === permOf(a.perm), on: "perm", arg: o.v }))))
        + `<button class="btn danger" data-on="rm">ازالة التطبيق</button>`,
      handlers: { perm: (v) => act("app.perm", { id: arg, perm: v }),
        rm: () => confirmSheet(`إزالة ${arg}؟`, "سيتوقف الوكيل عن استخدامه.", "إزالة",
          () => act("app.remove", { id: arg }, { back: true })) } };
  }

  if (head === "agents" && arg) {
    const a = S.agents.find(x => x.id === arg); if (!a) return null;
    const base = "agents/" + arg;

    if (sub === "thinking") return chooser("قوة التفكير", `خاص بـ${a.name}.`,
      [{ v: "", t: "استخدم الافتراضي", d: thinkName(S.defaultThinking) }, ...S.thinkingOptions.map(t => ({ v: t.v, t: t.t, d: t.d }))],
      () => a.thinking || "", (v) => act("agent.thinking", { id: arg, level: v }, { back: true }), "قوة التفكير");

    if (sub === "mentions") return { crumb: "كلمات المناداة", title: "كلمات المناداة",
      intro: "إذا كتب أحد إحدى هذه الكلمات في المجموعة، فسيرد هذا الوكيل. وإذا تركتها فارغة، يستخدم اسمه.",
      render: () => chipList(a.mentions, "لا توجد كلمات", "إضافة كلمة"),
      handlers: {
        add: () => formSheet("كلمة مناداة", "مثال: مصلح", [{ id: "w", label: "الكلمة" }], "إضافة",
          (v) => v.w && act("agent.mentions", { id: arg, patterns: [...a.mentions, v.w] })),
        rm: (w) => act("agent.mentions", { id: arg, patterns: a.mentions.filter(x => x !== w) }) } };

    if (sub === "memories") return { crumb: "اليوميات", title: "يوميات الوكيل",
      intro: "يكتب الوكيل ملخصا في نهاية كل يوم، وهذه هي الملخصات.",
      render: () => grp(a.memories.map(m => row({ title: m.replace(/\.md$/, ""), ltr: 1, go: `${base}/file/memory/${m}` }))) };

    if (sub === "skills") {
      const all = a.skills === null;
      return { crumb: "المهارات", title: "مهارات " + a.name,
        intro: "عند اختيار الجميع، يحصل الوكيل على كل مهارة جاهزة. وعند التحديد، لا يرى إلا ما تختاره.",
        render: () => {
          if (!SK) return `<div class="loading"><span class="spin dark"></span> جاري التحميل...</div>`;
          const head = sec("", grp([row({ title: "جميع المهارات الجاهزة", sw: all, on: "all" })]));
          if (all) return head;
          const line = (s) => row({ title: s.name, ltr: 1, desc: s.description,
            sw: (a.skills || []).includes(s.name), on: "tog", arg: s.name });
          // The whole catalog is listed: a skill can be selected for an agent
          // before its requirements exist, and hiding it looks like a bug.
          const ready = (SK.skills || []).filter(s => s.eligible);
          const rest = (SK.skills || []).filter(s => !s.eligible && !s.platformIncompatible);
          return head + sec("جاهزة", grp(ready.map(line)))
            + (rest.length ? sec("تحتاج إعدادا", grp(rest.map(line)),
                "يمكنك اختيارها الآن، ولن تعمل حتى تكتمل متطلباتها.") : "");
        },
        mounted: async () => { if (!SK) { await loadSkills(); render(); } },
        handlers: {
          all: () => all ? act("agent.skills", { id: arg, skills: [] }) : act("agent.skills", { id: arg, all: true }),
          tog: (n) => {
            const cur = a.skills || [];
            act("agent.skills", { id: arg, skills: cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n] });
          } } };
    }

    if (sub === "mcp") return { crumb: "خوادم MCP", title: "خوادم MCP",
      intro: "اختر الخوادم التي يستطيع هذا الوكيل الوصول إليها.",
      render: () => sec("", grp(S.mcp.map(m => row({ title: m.name, ltr: 1,
          desc: !m.enabled ? "متوقف لكل الوكلاء"
            : m.agents ? "لـ " + m.agents.map(agentName).join("، ") : "يصل إليه كل الوكلاء",
          sw: m.enabled && (!m.agents || m.agents.includes(arg)), on: "tog", arg: m.name }))))
        + sec("", grp([row({ title: "إضافة خادم لهذا الوكيل", on: "add" })])),
      handlers: {
        add: () => addMcpSheet(arg),
        tog: (name) => {
          const m = S.mcp.find(x => x.name === name);
          act("mcp.agentAccess", { name, agentId: arg, on: !(m.enabled && (!m.agents || m.agents.includes(arg))) });
        } } };

    if (sub === "file") {
      const name = tail;
      const meta = a.files.find(f => f.name === name);
      const label = meta?.label || name.replace("memory/", "").replace(/\.md$/, "");
      return { crumb: label, title: label, intro: meta?.desc,
        render: () => `${editorTabs()}<div class="editor"><textarea id="fbody"></textarea></div>
          <button class="btn" data-on="save">حفظ</button>
          <p class="hint">تحفظ نسخة احتياطية قبل كل عملية حفظ.</p>`,
        mounted: async () => {
          const r = await fetch(`api/file?agent=${encodeURIComponent(arg)}&name=${encodeURIComponent(name)}`, { credentials: "include" });
          const j = await r.json().catch(() => ({}));
          mountEditor($("#fbody"), j.ok ? j.content : "");
        },
        handlers: {
          tabEdit: () => setEditorTab("edit"),
          tabPreview: () => setEditorTab("preview"),
          save: async (v, btn) => {
            btn.disabled = true;
            /* Saving from the preview tab must still save what was typed.
               MDE.value() reads the document, not the visible pane, so preview
               stays a view and never a source of truth. */
            await act("file.write", { agentId: arg, file: name, content: MDE ? MDE.value() : $("#fbody").value });
            btn.disabled = false;
          } } };
    }

    const groups = S.bindings.filter(b => b.agentId === arg);
    return { crumb: a.name, title: a.name, intro: a.description || undefined,
      render: () =>
        sec("الاساسيات", grp([
          row({ title: "الاسم", value: a.name, on: "rename" }),
          row({ title: "الوصف", value: a.description || "لا يوجد", on: "describe" }),
          ...(a.isMain ? [row({ title: "الوكيل الرئيسي", value: "نعم" })]
            : [row({ title: "اجعله الوكيل الرئيسي", on: "main" })]),
        ]))
        + sec("العقل", grp([
          row({ title: "النموذج", value: a.model ? modelName(a.model) : "الافتراضي", go: "models/" + arg }),
          row({ title: "مستوى التفكير", value: a.thinking ? thinkName(a.thinking) : "الافتراضي", go: `${base}/thinking` }),
        ]))
        + sec("ملفاته", grp(a.files.map(f => row({ icon: "file", title: f.label, desc: f.desc,
            value: f.bytes === null ? "فارغ" : "", go: `${base}/file/${f.name}` })))
          + grp([row({ icon: "memory", title: "اليوميات", value: a.memories.length ? `${a.memories.length}` : "لا يوجد", go: `${base}/memories` })]),
          "هذه ملفات نصية داخل مجلد الوكيل، ويمكنك تعديلها كما تشاء.")
        + sec("قدراته", grp([
          row({ title: "المهارات", value: a.skills === null ? "الجميع" : `${a.skills.length}`, go: `${base}/skills` }),
          row({ title: "خوادم MCP", value: `${S.mcp.length}`, go: `${base}/mcp` }),
          row({ title: "التطبيقات", value: "مشتركة", go: "apps" }),
        ]), "يمكن تخصيص المهارات وخوادم MCP لكل وكيل على حدة، أما التطبيقات فمشتركة بين الجميع.")
        + sec("واتساب", grp([
            row({ title: "كلمات المناداة", value: a.mentions.length ? a.mentions.join("، ") : "اسمه", go: `${base}/mentions` }),
            ...groups.map(g => row({ title: g.peer, ltr: 1, value: "مربوط", on: "unbind", arg: g.peer })),
            row({ title: "ربط مجموعة", on: "bind" }),
          ]), "للحصول على معرف المجموعة، أرسل <code>/id</code> داخلها.")
        + (a.isMain ? "" : `<button class="btn danger" data-on="del">حذف الوكيل</button>`),
      handlers: {
        rename: () => formSheet("اسم الوكيل", "", [{ id: "n", label: "الاسم", value: a.name }], "حفظ",
          (v) => act("agent.rename", { id: arg, name: v.n })),
        describe: () => formSheet("وصف الوكيل", "لك وحدك، للتمييز بين الوكلاء.",
          [{ id: "d", label: "الوصف", value: a.description, multiline: true }], "حفظ",
          (v) => act("agent.describe", { id: arg, description: v.d })),
        main: () => confirmSheet("جعله الوكيل الرئيسي؟", "سيرد على كل ما ليس مرتبطا بوكيل آخر.", "تأكيد",
          () => act("agent.main", { id: arg })),
        bind: () => formSheet("ربط مجموعة", "أرسل /id داخل المجموعة للحصول على المعرف.",
          [{ id: "g", label: "معرف المجموعة", placeholder: "1203...@g.us", ltr: true }], "ربط",
          (v) => v.g && act("agent.bind", { agentId: arg, peer: v.g })),
        unbind: (peer) => confirmSheet("إلغاء الربط؟", "ستعود المجموعة إلى الوكيل الرئيسي.", "إلغاء الربط",
          () => act("agent.bind", { agentId: null, peer })),
        del: () => confirmSheet(`حذف ${a.name}؟`, "ستبقى ملفاته وذاكرته على القرص، لكنه لن يرد بعد الآن.", "حذف",
          () => act("agent.delete", { id: arg }, { back: true })) } };
  }

  if (head === "skills" && arg) {
    // Deep links and reloads land here before the CLI-backed list exists; show a
    // loader and fetch rather than bouncing the user back to the home page.
    if (!SK) return { crumb: arg, title: arg,
      render: () => `<div class="loading"><span class="spin dark"></span> جاري التحميل...</div>`,
      mounted: async () => { await loadSkills(); render(); } };
    const s = (SK.skills || []).find(x => x.name === arg); if (!s) return null;
    const on = S.skillEntries[arg] !== false;
    return { crumb: arg, title: s.name, intro: s.description,
      render: () => sec("", grp([row({ title: "مفعلة", sw: on, on: "tog" })]))
        + (s.missing.length ? sec("متطلبات ناقصة", grp(s.missing.map(m => row({ title: m }))),
            "يجب تثبيت هذه المتطلبات على الخادم حتى تعمل المهارة. يمكنك أن تطلب من الوكيل تثبيتها.") : "")
        + (s.platformIncompatible ? `<div class="note warn">هذه المهارة لا تعمل على هذا النظام.</div>` : "")
        + sec("", grp([row({ title: "المصدر", value: s.bundled ? "مدمجة مع OpenClaw" : s.source })]))
        + (s.bundled ? "" : `<button class="btn danger" data-on="rm">حذف المهارة</button>`),
      handlers: {
        tog: () => act("skill.enable", { name: arg, on: !on }),
        rm: () => confirmSheet(`حذف ${arg}؟`, "سيتم حذفها من الخادم نهائيا.", "حذف", async () => {
          const j = await gwAct("skills.remove", { name: arg });
          toast(j.msg, !j.ok);
          if (j.ok) { await loadSkills(true); closeSheet(); history.back(); }
        }) } };
  }

  if (head === "models" && arg) {
    const isDefault = arg === "default";
    const a = isDefault ? null : S.agents.find(x => x.id === arg);
    if (!isDefault && !a) return null;
    const cur = isDefault ? S.defaultModel : (a.model || "");
    const same = (m) => m.ref === cur || m.slug === String(cur || "").split("/").pop();
    // A matching slug on the openai/* route reaches the same model with a smaller
    // declared window and no image input, so nudge the user onto codex/* once.
    const offRoute = cur && !String(cur).startsWith("codex/") && S.catalog.some(same);
    return { crumb: isDefault ? "الافتراضي" : a.name, title: isDefault ? "النموذج الافتراضي" : a.name,
      intro: S.catalog.length ? "هذه النماذج المتاحة في اشتراكك." : "تعذر قراءة قائمة النماذج.",
      render: () => (offRoute ? `<div class="note warn"><b>نصيحة</b>
        اضغط على النموذج المحدد مرة واحدة لنقله إلى المسار الأفضل: ذاكرة أكبر، وإمكانية قراءة الصور.</div>` : "")
        + grp([
        ...(isDefault ? [] : [row({ title: "استخدام الافتراضي", desc: modelName(S.defaultModel), sel: !a.model, on: "pick", arg: "" })]),
        ...S.catalog.map(m => row({ title: m.name, desc: m.desc,
          value: m.retiring ? "سيتوقف قريبا" : undefined, sel: same(m), on: "pick", arg: m.ref }))]),
      handlers: { pick: (m) => isDefault ? act("model.default", { model: m }, { back: true })
        : act("model.agent", { id: arg, model: m }, { back: true }) } };
  }

  if (head === "mcp" && arg) {
    const m = S.mcp.find(x => x.name === arg); if (!m) return null;
    const authLabel = m.oauth ? "تسجيل دخول (OAuth)"
      : m.hasHeaderAuth ? "مفتاح في الترويسة" : "بدون";
    // A query-string token is fixable; a path token is part of the address and
    // must be left alone, so the two cases get different advice.
    const secretNote = m.secretIn === "query"
      ? `<div class="note warn" style="margin-top:16px"><b>المفتاح داخل الرابط</b>
          معيار MCP يمنع وضع المفتاح في نهاية الرابط. إذا كانت الخدمة تدعم الترويسة،
          احذف الخادم وأعد إضافته مع وضع المفتاح في خانة «مفتاح الوصول».</div>`
      : m.secretIn === "path"
      ? `<div class="note" style="margin-top:16px"><b>الرابط يحتوي على مفتاح</b>
          بعض الخدمات تضع المفتاح داخل مسار الرابط. هذا جزء من العنوان ولا يمكن نقله،
          فلا تعدله. تعامل مع الرابط كاملا على أنه كلمة سر ولا تشاركه.</div>`
      : "";
    return { crumb: arg, title: arg,
      render: () => sec("", grp([
          row({ title: "مفعل", sw: m.enabled, on: "tog" }),
          row({ title: "يطلب الإذن قبل التنفيذ",
            desc: "أطفئه إذا كنت تثق بهذا الخادم ولا تريد سؤالا قبل كل أداة",
            sw: m.approval !== "approve", on: "approval" }),
        ]))
        + sec("التفاصيل", grp([row({ title: "النوع", value: m.transport }),
          row({ title: "العنوان", value: m.url || m.command || "—", ltr: 1 }),
          row({ title: "طريقة الدخول", value: authLabel }),
          row({ title: "متاح لـ", value: m.agents ? m.agents.map(agentName).join("، ") : "كل الوكلاء" })]),
          "لتغيير ذلك، افتح صفحة الوكيل ثم قدراته ثم خوادم MCP.")
        + (m.oauth ? sec("تسجيل الدخول", grp([
              row({ title: "ابدأ تسجيل الدخول", on: "login" }),
              row({ title: "إلغاء الربط", on: "logout" }),
            ]), "لا يحفظ أي مفتاح في ملف الإعدادات؛ يخزن الربط في قاعدة بيانات الخادم.")
            + `<div id="oa"></div>` : "")
        + secretNote
        + `<button class="btn danger" data-on="rm">حذف الخادم</button>`,
      handlers: {
        tog: () => act("mcp.enable", { name: arg, on: !m.enabled }),
        // On = Codex's "auto" (asks for tools flagged destructive/open-world),
        // off = "approve", which is Codex-speak for pre-approved.
        approval: () => act("mcp.approval", { name: arg, mode: m.approval === "approve" ? "auto" : "approve" }),
        login: async (v, btn) => {
          // Discovery plus dynamic client registration; ~15s is normal here.
          btn.innerHTML = `<span class="tx"><span class="t">جاري التحضير...</span>
            <span class="d">قد يستغرق نحو خمس عشرة ثانية</span></span>`;
          const j = await gwAct("mcp.login", { name: arg });
          btn.innerHTML = `<span class="tx"><span class="t">ابدأ تسجيل الدخول</span></span>`;
          if (!j.ok) return toast(j.msg || "تعذر البدء", true);
          $("#oa").innerHTML = `<ol class="steps" style="margin-top:22px">
              <li>افتح الرابط التالي ووافق على الصلاحيات.</li>
              <li>سيحاول المتصفح فتح صفحة لا تعمل، وهذا طبيعي.</li>
              <li>انسخ الرابط كاملا من شريط العنوان وألصقه بالأسفل.</li></ol>
            <div class="note ltr" style="margin-top:14px;word-break:break-all">${esc(j.url)}</div>
            <label class="fl">الرابط الذي وصلت إليه</label>
            <input type="url" id="oacode" class="ltr" placeholder="http://127.0.0.1:8989/oauth/callback?code=...">
            <button class="btn" data-on="finish">إكمال الربط</button>`;
          bind($("#oa"), resolve(location.hash.replace(/^#\/?/, "")));
        },
        finish: async (v, btn) => {
          const code = $("#oacode")?.value.trim();
          if (!code) return;
          btn.disabled = true; btn.textContent = "جاري الربط...";
          const j = await gwAct("mcp.loginComplete", { name: arg, code });
          btn.disabled = false; btn.textContent = "إكمال الربط";
          toast(j.msg, !j.ok);
          if (j.ok) $("#oa").innerHTML = `<div class="note" style="margin-top:16px">تم الربط بنجاح.</div>`;
        },
        logout: () => confirmSheet("إلغاء الربط؟", "سيتوقف الخادم حتى تسجل الدخول مرة أخرى.", "إلغاء الربط",
          async () => { const j = await gwAct("mcp.logout", { name: arg }); toast(j.msg, !j.ok); closeSheet(); }),
        rm: () => confirmSheet(`حذف ${arg}؟`, "سيفقد الوكلاء القدرات التي يوفرها.", "حذف",
          () => act("mcp.remove", { name: arg }, { back: true })) } };
  }
  return null;
}

/* ---------- render ---------- */
function crumbsFor(p) {
  const parts = p ? p.split("/") : [];
  const trail = [{ p: "", label: R[""].crumb }];
  for (let i = 0; i < parts.length; i++) {
    const sub = parts.slice(0, i + 1).join("/");
    const r = resolve(sub);
    if (r && !trail.some(x => x.label === (r.crumb || r.title))) trail.push({ p: sub, label: r.crumb || r.title });
  }
  return trail;
}
function render() {
  closeSheet();
  // The editor owns DOM outside #main's control; drop it before the page swaps.
  destroyEditor();
  const p = location.hash.replace(/^#\/?/, "");
  const r = resolve(p);
  if (!r) { location.hash = "#/"; return; }
  const trail = crumbsFor(p);
  $("#back").hidden = !p;
  const cr = $("#crumbs");
  cr.hidden = !p;
  cr.innerHTML = trail.map((c, i) => i === trail.length - 1
    ? `<b>${esc(c.label)}</b>` : `<a href="#/${c.p}">${esc(c.label)}</a>`)
    .join(`<span class="sep">${CHEV}</span>`);
  $("#main").innerHTML = `<div class="page"><h1 class="title" dir="auto">${esc(r.title)}</h1>
    ${r.intro ? `<p class="intro">${esc(r.intro)}</p>` : ""}${r.render()}</div>`;
  bind($("#main"), r);
  r.mounted?.();
  document.title = (p ? r.title + " — " : "") + "اكستند";
}
function bind(root, r) {
  root.querySelectorAll("[data-go]").forEach(b => b.onclick = () => location.hash = "#/" + b.dataset.go);
  root.querySelectorAll("[data-on]").forEach(b => b.onclick = () => r.handlers?.[b.dataset.on]?.(b.dataset.arg, b));
}
addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
$("#back").onclick = () => history.back();
addEventListener("hashchange", render);
load().then(() => {
  render();
  // The skills list costs a CLI spawn (~9s). Warm it while the user reads the
  // home screen so opening المهارات is instant; failures stay silent here.
  loadSkills().then(() => { if (location.hash.replace(/^#\/?/, "").startsWith("skills")) render(); }).catch(() => {});
}).catch(() => toast("تعذر تحميل البيانات", true));
