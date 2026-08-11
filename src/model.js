import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/* ---------- config access ----------
   Writes go straight to openclaw.json. `runtime.gateway.request` would give us
   schema validation and restart planning for free, but it is gated to bundled
   and trusted-official plugins — a third-party install gets
   "Gateway requests are only available to bundled or trusted official plugins."
   so config.get/config.apply are not reachable from here.

   Consequences we handle ourselves:
   - concurrency: `hash` is of the exact bytes we read, rechecked under write,
     so a second tab's stale save fails instead of erasing the first one.
   - durability: write to a temp file in the same directory and rename, so a
     crash mid-write cannot leave a truncated config. One .bak is kept.
   - reload: the gateway watches this file and hot-reloads on change, which is
     what makes an edit take effect without a restart. */
export function createConfigStore({ configPath }) {
  const hashOf = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

  return {
    async get() {
      const raw = fs.readFileSync(configPath, "utf8");
      return { config: JSON.parse(raw), hash: hashOf(raw) };
    },
    async apply(config, baseHash) {
      if (baseHash && hashOf(fs.readFileSync(configPath, "utf8")) !== baseHash) {
        throw new Error("تم تعديل الإعدادات من مكان آخر. أعد تحميل الصفحة وحاول مرة أخرى.");
      }
      const next = JSON.stringify(config, null, 2) + "\n";
      // Same directory so the rename stays atomic (no cross-device copy).
      const tmp = `${configPath}.extend-panel.tmp`;
      fs.writeFileSync(tmp, next, { mode: 0o600 });
      try { fs.copyFileSync(configPath, `${configPath}.bak`); } catch {}
      fs.renameSync(tmp, configPath);
    },
  };
}

/* ---------- agent roster ----------
   Current OpenClaw keys agents under `agents.entries`; older gateways accept
   only the `agents.list` array and reject `entries`. Normalize to an array to
   work with, then write back in whichever shape the config already uses so a
   panel edit never migrates someone's config out from under their gateway. */
const rosterShape = (c) =>
  c.agents?.entries && typeof c.agents.entries === "object" && !Array.isArray(c.agents.entries)
    ? "entries"
    : Array.isArray(c.agents?.list) ? "list" : null;

export function rosterOf(c) {
  const shape = rosterShape(c);
  if (shape === "entries") {
    return Object.entries(c.agents.entries).map(([id, v]) => ({ id, ...(v || {}) }));
  }
  return shape === "list" ? c.agents.list : [];
}

/** Writes the roster back in the config's existing shape (canonical when new). */
export function setRoster(c, list) {
  const agents = (c.agents ??= {});
  if (rosterShape(c) === "list") {
    agents.list = list;
    return;
  }
  agents.entries = Object.fromEntries(list.map(({ id, ...rest }) => [id, rest]));
  delete agents.list;
}

/** Applies `fn` to one agent and writes the roster back. Throws when missing. */
export function updateAgent(c, id, fn) {
  const list = rosterOf(c);
  const found = list.find((a) => a.id === id);
  if (!found) throw new Error("الوكيل غير موجود");
  fn(found);
  setRoster(c, list);
  return found;
}

export const defaultAgentId = (c) => {
  const list = rosterOf(c);
  return (list.find((a) => a.default === true) || list[0])?.id || "main";
};
export const findAgent = (c, id) => rosterOf(c).find((a) => a.id === id);

/* ---------- agent files ---------- */
const FILES = [
  { name: "SOUL.md", label: "الشخصية", desc: "طباعه وأسلوبه في الحديث" },
  { name: "AGENTS.md", label: "التعليمات", desc: "القواعد التي يلتزم بها" },
  { name: "IDENTITY.md", label: "الهوية", desc: "اسمه وتعريفه" },
  { name: "USER.md", label: "معلومات عنك", desc: "حتى يتعرف عليك" },
  { name: "MEMORY.md", label: "الذاكرة الدائمة", desc: "الحقائق التي لا ينساها" },
];
const FILE_NAMES = new Set(FILES.map((f) => f.name));
const MAX_FILE_BYTES = 256 * 1024;

const THINKING = [
  { v: "low", t: "سريع", d: "يجيب بسرعة، ومناسب للأسئلة اليومية" },
  { v: "medium", t: "متوازن", d: "يفكر قليلا قبل أن يجيب" },
  { v: "high", t: "عميق", d: "يفكر أكثر، فيكون أبطأ وأدق" },
  { v: "xhigh", t: "عميق جدا", d: "للمهام الصعبة والطويلة" },
];

/* The upstream model descriptions are English and coding-centric; this audience
   reads Arabic and cares about speed vs depth. Unknown slugs keep English. */
const MODEL_AR = {
  "gpt-5.6-sol": "الأقوى، للمهام المعقدة والطويلة",
  "gpt-5.6-terra": "متوازن، وهو الأفضل للاستخدام اليومي",
  "gpt-5.6-luna": "الأسرع والأقل تكلفة، للردود القصيرة",
  "gpt-5.5": "قوي وسريع، من الجيل السابق",
  "gpt-5.4": "مناسب للمهام الاعتيادية",
  "gpt-5.4-mini": "صغير وسريع جدا، للمهام البسيطة",
};

/* A pasted key can pick up surrounding page text on mobile select-all. A header
   value with spaces or newlines is silently unusable, so reject it at entry
   instead of writing a broken Authorization header. */
function normalizeMcpToken(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const bare = raw.replace(/^Bearer\s+/i, "").trim();
  if (!bare) return "";
  if (bare.length > 4096) throw new Error("المفتاح طويل بشكل غير معتاد، تأكد مما نسخته");
  if (/\s/.test(bare)) throw new Error("المفتاح يحتوي على مسافات أو أسطر. انسخ المفتاح وحده بدون نص حوله");
  return bare;
}

/** Short slug from the host, so "https://mcp.notion.com/mcp" becomes "notion". */
function deriveMcpName(url) {
  let host = "";
  try { host = new URL(url).hostname; } catch { return ""; }
  const parts = host.split(".").filter((p) => p && p !== "www" && p !== "mcp" && p !== "api");
  const base = (parts.length > 1 ? parts[parts.length - 2] : parts[0]) || host;
  return base.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

/* Credentials embedded in an MCP URL stay readable in the panel, so show a
   masked form. Two very different cases:
   - query (`?token=x`) — the MCP spec says access tokens MUST NOT go in the
     query string, so this is worth flagging as fixable.
   - path (`/mcp/<token>/sse`) — a pre-OAuth vendor shortcut. The segment is
     part of the address the server routes on, so it can never move to a header
     without breaking the connection. Flag it, never rewrite it. */
const SECRET_PARAM_RE = /token|key|secret|pass|auth|jwt|session|code|signature|credential/i;
/** Long opaque segment that looks like a credential rather than a route name. */
const SECRET_PATH_SEG_RE = /^[A-Za-z0-9_-]{20,}$/;
const looksSecretSegment = (s) => SECRET_PATH_SEG_RE.test(s) && /\d/.test(s) && /[a-z]/i.test(s);

export function classifyUrlSecret(url) {
  if (!url) return "none";
  let u;
  try { u = new URL(url); } catch { return "none"; }
  if (u.username || u.password) return "query";
  for (const k of u.searchParams.keys()) if (SECRET_PARAM_RE.test(k)) return "query";
  if (u.pathname.split("/").filter(Boolean).some(looksSecretSegment)) return "path";
  return "none";
}

export function maskUrl(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return url; }
  if (u.username || u.password) { u.username = "***"; u.password = ""; }
  for (const k of [...u.searchParams.keys()]) {
    if (SECRET_PARAM_RE.test(k)) u.searchParams.set(k, "***");
  }
  u.pathname = "/" + u.pathname.split("/").filter(Boolean)
    .map((s) => (looksSecretSegment(s) ? "***" : s)).join("/");
  return u.toString();
}

/**
 * Panel data model bound to one OpenClaw install.
 * `dataDir` is the resolved OpenClaw home; everything on disk hangs off it.
 */
export function createModel({ store, dataDir, codexDir }) {
  const envFile = path.join(dataDir, "extend.env");

  /* Workspace resolution mirrors OpenClaw: the default agent owns
     `agents.defaults.workspace`; every other agent gets a subfolder of it. */
  function workspaceOf(c, id) {
    const a = findAgent(c, id);
    if (a?.workspace) return a.workspace;
    const base = c.agents?.defaults?.workspace || path.join(dataDir, "workspace");
    return id === defaultAgentId(c) ? base : path.join(base, id);
  }
  const agentDirOf = (c, id) =>
    findAgent(c, id)?.agentDir || path.join(dataDir, "agents", id, "agent");

  /** Only the known bootstrap files and dated memory logs are addressable. */
  function resolveAgentFile(c, agentId, rel) {
    const name = String(rel || "");
    const ok = FILE_NAMES.has(name) || /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(name);
    if (!ok) throw new Error("هذا الملف غير مسموح به");
    const ws = workspaceOf(c, agentId);
    const full = path.resolve(ws, name);
    if (full !== path.join(ws, name)) throw new Error("المسار غير صالح");
    return full;
  }

  function listAgentFiles(c, id) {
    const ws = workspaceOf(c, id);
    return FILES.map((f) => {
      let bytes = null;
      try { bytes = fs.statSync(path.join(ws, f.name)).size; } catch {}
      return { ...f, bytes };
    });
  }
  function listMemories(c, id) {
    try {
      return fs.readdirSync(path.join(workspaceOf(c, id), "memory"))
        .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort().reverse().slice(0, 60);
    } catch { return []; }
  }

  /* The Codex app-server caches the account's live catalog per agent. That file
     is the only honest source for "models this subscription can actually
     serve", so an empty catalog means no model picker rather than a guess. */
  function codexCatalog(c) {
    for (const id of [defaultAgentId(c), ...rosterOf(c).map((a) => a.id)]) {
      try {
        const raw = fs.readFileSync(path.join(agentDirOf(c, id), "codex-home", "models_cache.json"), "utf8");
        const models = (JSON.parse(raw).models || []).filter((m) => m.visibility === "list" && m.slug);
        if (models.length) {
          return models.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).map((m) => ({
            slug: m.slug,
            ref: "codex/" + m.slug,
            name: m.display_name || m.slug,
            desc: MODEL_AR[m.slug] || m.description || "",
            // OpenAI ships a retirement notice on the entry itself; surface it
            // so nobody picks a model that is about to stop answering.
            retiring: Boolean(m.upgrade?.model),
            efforts: (m.supported_reasoning_levels || []).map((e) => e.effort),
          }));
        }
      } catch {}
    }
    return [];
  }

  /* `agents.defaults.models` doubles as the legacy override allowlist on
     configs without a migration marker, so anything the panel offers as a
     choice has to be listed there or the run is rejected at dispatch. */
  function syncModelAllowlist(c, catalog) {
    const m = (((c.agents ??= {}).defaults ??= {}).models ??= {});
    if (Object.keys(m).length === 0) return;
    for (const e of catalog) m[e.ref] ??= {};
  }

  const codexInstalled = () => {
    const out = new Set();
    try {
      const toml = fs.readFileSync(path.join(codexDir, "config.toml"), "utf8");
      for (const m of toml.matchAll(/\[plugins\."([^"@]+)@([^"]+)"\]/g)) out.add(m[1]);
    } catch {}
    try {
      const b = path.join(codexDir, "plugins", "cache");
      for (const mk of fs.readdirSync(b)) for (const n of fs.readdirSync(path.join(b, mk))) out.add(n);
    } catch {}
    return [...out];
  };

  const readEnvFile = () => {
    try {
      return fs.readFileSync(envFile, "utf8").split("\n").filter(Boolean).map((l) => {
        const i = l.indexOf("=");
        return { key: l.slice(0, i), value: l.slice(i + 1) };
      }).filter((e) => e.key);
    } catch { return []; }
  };
  const writeEnvFile = (list) =>
    fs.writeFileSync(envFile, list.map((e) => `${e.key}=${e.value}`).join("\n") + "\n", { mode: 0o600 });

  async function buildState() {
    const { config: c } = await store.get();
    const cp = c.plugins?.entries?.codex?.config?.codexPlugins || {};
    const apps = cp.plugins || {};
    const wa = c.channels?.whatsapp || {};
    const mainId = defaultAgentId(c);
    const catalog = codexCatalog(c);
    const agents = rosterOf(c).map((a) => ({
      id: a.id,
      name: a.name || a.id,
      description: a.description || "",
      model: a.model?.primary || (typeof a.model === "string" ? a.model : null),
      thinking: a.thinkingDefault || null,
      mentions: a.groupChat?.mentionPatterns || [],
      skills: a.skills || null,
      files: listAgentFiles(c, a.id),
      memories: listMemories(c, a.id),
      workspace: workspaceOf(c, a.id),
      isMain: a.id === mainId,
    }));
    return {
      apps: Object.entries(apps).map(([id, v]) => ({
        id, perm: v.allow_destructive_actions ?? true, enabled: v.enabled !== false,
      })),
      unmanaged: codexInstalled().filter((i) => !apps[i]),
      allowAll: cp.allow_all_plugins === true,
      agents,
      bindings: (c.bindings || []).map((b) => ({
        agentId: b.agentId, channel: b.match?.channel,
        peer: b.match?.peer?.id, kind: b.match?.peer?.kind,
      })),
      defaultModel: c.agents?.defaults?.model?.primary || c.agents?.defaults?.model || null,
      defaultThinking: c.agents?.defaults?.thinkingDefault || "low",
      catalog,
      thinkingOptions: THINKING,
      whatsapp: {
        dmPolicy: wa.dmPolicy || "pairing",
        groupPolicy: wa.groupPolicy || "allowlist",
        allowFrom: wa.allowFrom || [],
        groupAllowFrom: wa.groupAllowFrom || [],
        selfChatMode: wa.selfChatMode === true,
        requireMention: wa.groups?.["*"]?.requireMention !== false,
        autoReply: (c.messages?.groupChat?.visibleReplies || "automatic") !== "message_tool",
        debounceMs: typeof wa.debounceMs === "number" ? wa.debounceMs : 2000,
      },
      mcp: Object.entries(c.mcp?.servers || {}).map(([name, v]) => ({
        name,
        transport: v.transport || (v.command ? "stdio" : "streamable-http"),
        url: maskUrl(v.url) || null,
        secretIn: classifyUrlSecret(v.url),
        hasHeaderAuth: Boolean(v.headers?.Authorization),
        command: v.command || null,
        enabled: v.enabled !== false,
        oauth: v.auth === "oauth",
        agents: v.codex?.agents || null,
        approval: v.codex?.defaultToolsApprovalMode || "auto",
      })),
      // Config-level on/off, separate from whether a skill's requirements are met.
      skillEntries: Object.fromEntries(
        Object.entries(c.skills?.entries || {}).map(([k, v]) => [k, v?.enabled !== false])),
      env: readEnvFile(),
    };
  }

  async function readFileFor(agentId, rel) {
    const { config: c } = await store.get();
    const full = resolveAgentFile(c, agentId, rel);
    let content = "";
    try {
      if (fs.statSync(full).size > MAX_FILE_BYTES) throw new Error("حجم الملف كبير جدا");
      content = fs.readFileSync(full, "utf8");
    } catch (e) { if (e?.code !== "ENOENT") throw e; }
    return { ok: true, content };
  }

  async function mutate(action, d) {
    const { config: c, hash } = await store.get();
    let msg = "";
    const codexCfg = () => {
      const e = ((c.plugins ??= {}).entries ??= {});
      const cd = (e.codex ??= { enabled: true });
      const cpx = ((cd.config ??= {}).codexPlugins ??= { enabled: true, plugins: {} });
      cpx.plugins ??= {};
      return cpx;
    };

    switch (action) {
      /* ---- files and env live outside openclaw.json, so they return early ---- */
      case "env.set": {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(d.key || "")) {
          throw new Error("الاسم يجب أن يتكون من حروف إنجليزية كبيرة وشرطة سفلية");
        }
        const list = readEnvFile().filter((e) => e.key !== d.key);
        list.push({ key: d.key, value: String(d.value ?? "") });
        writeEnvFile(list);
        return "تم حفظ المتغير";
      }
      case "env.unset":
        writeEnvFile(readEnvFile().filter((e) => e.key !== d.key));
        return "تم الحذف";
      case "file.write": {
        const full = resolveAgentFile(c, d.agentId, d.file);
        const body = String(d.content ?? "");
        if (Buffer.byteLength(body) > MAX_FILE_BYTES) throw new Error("حجم الملف كبير جدا");
        fs.mkdirSync(path.dirname(full), { recursive: true });
        if (fs.existsSync(full)) fs.copyFileSync(full, full + ".extend-bak");
        fs.writeFileSync(full, body);
        return "تم حفظ الملف";
      }

      case "app.add": {
        if (!/^[a-z0-9-]+$/.test(d.id || "")) throw new Error("الاسم غير صالح");
        const cpx = codexCfg();
        cpx.enabled = true;
        cpx.plugins[d.id] = {
          enabled: true, marketplaceName: "openai-curated", pluginName: d.id,
          allow_destructive_actions: d.perm === "ask" ? "ask" : d.perm === "false" ? false : true,
        };
        msg = `تمت إضافة ${d.id}`; break;
      }
      case "app.perm": {
        const cpx = codexCfg();
        if (cpx.plugins[d.id]) {
          cpx.plugins[d.id].allow_destructive_actions =
            d.perm === "ask" ? "ask" : d.perm === "false" ? false : true;
        }
        msg = "تم حفظ الصلاحية"; break;
      }
      case "app.remove": { delete codexCfg().plugins[d.id]; msg = `تمت إزالة ${d.id}`; break; }
      case "app.allowall": { codexCfg().allow_all_plugins = false; msg = "تم إيقاف السماح لكل التطبيقات"; break; }

      case "agent.create": {
        const id = String(d.id || "").trim();
        if (!/^[a-z0-9-]{2,30}$/.test(id)) {
          throw new Error("المعرف يجب أن يتكون من حروف إنجليزية صغيرة وشرطات فقط");
        }
        if (findAgent(c, id)) throw new Error("هذا المعرف مستخدم بالفعل");
        setRoster(c, [...rosterOf(c),
          { id, name: d.name || id, ...(d.model ? { model: { primary: d.model } } : {}) }]);
        msg = `تم إنشاء ${d.name || id}`; break;
      }
      case "agent.delete": {
        if (d.id === defaultAgentId(c)) throw new Error("لا يمكن حذف الوكيل الرئيسي");
        setRoster(c, rosterOf(c).filter((a) => a.id !== d.id));
        c.bindings = (c.bindings || []).filter((b) => b.agentId !== d.id);
        msg = "تم الحذف"; break;
      }
      case "agent.main": {
        if (!findAgent(c, d.id)) throw new Error("الوكيل غير موجود");
        // Explicit marker instead of array order: order is only a fallback.
        setRoster(c, rosterOf(c).map((a) => {
          const { default: _was, ...rest } = a;
          return a.id === d.id ? { ...rest, default: true } : rest;
        }));
        msg = "أصبح هو الوكيل الرئيسي"; break;
      }
      case "agent.rename": {
        const name = String(d.name || "").trim();
        if (!name) throw new Error("الاسم مطلوب");
        updateAgent(c, d.id, (a) => { a.name = name; });
        msg = "تم حفظ الاسم"; break;
      }
      case "agent.describe": {
        const t = String(d.description || "").trim();
        updateAgent(c, d.id, (a) => { if (t) a.description = t; else delete a.description; });
        msg = "تم حفظ الوصف"; break;
      }
      case "agent.thinking": {
        if (d.level && !THINKING.some((t) => t.v === d.level)) throw new Error("القيمة غير صالحة");
        updateAgent(c, d.id, (a) => {
          if (d.level) a.thinkingDefault = d.level; else delete a.thinkingDefault;
        });
        msg = "تم حفظ مستوى التفكير"; break;
      }
      case "agent.mentions": {
        const list = (d.patterns || []).map((s) => String(s).trim()).filter(Boolean);
        updateAgent(c, d.id, (a) => {
          if (list.length) a.groupChat = { ...(a.groupChat || {}), mentionPatterns: list };
          else if (a.groupChat) {
            delete a.groupChat.mentionPatterns;
            if (!Object.keys(a.groupChat).length) delete a.groupChat;
          }
        });
        msg = "تم حفظ كلمات المناداة"; break;
      }
      case "agent.skills": {
        // Omitted means "inherit every skill"; a list is the final set.
        updateAgent(c, d.id, (a) => {
          if (d.all) delete a.skills;
          else a.skills = (d.skills || []).map((s) => String(s)).filter(Boolean);
        });
        msg = "تم حفظ مهارات الوكيل"; break;
      }
      case "agent.bind": {
        c.bindings = (c.bindings || []).filter(
          (b) => !(b.match?.peer?.id === d.peer && b.match?.channel === "whatsapp"));
        if (d.agentId) {
          c.bindings.push({
            match: { channel: "whatsapp", peer: { kind: "group", id: d.peer } },
            agentId: d.agentId,
          });
        }
        msg = "تم ربط المجموعة"; break;
      }

      case "model.default": {
        const cat = codexCatalog(c);
        if (!cat.some((e) => e.ref === d.model)) throw new Error("هذا النموذج غير متاح في اشتراكك");
        ((c.agents ??= {}).defaults ??= {}).model = { primary: d.model };
        syncModelAllowlist(c, cat);
        msg = "تم تغيير النموذج"; break;
      }
      case "model.agent": {
        const cat = codexCatalog(c);
        if (d.model && !cat.some((e) => e.ref === d.model)) {
          throw new Error("هذا النموذج غير متاح في اشتراكك");
        }
        updateAgent(c, d.id, (a) => {
          if (d.model) a.model = { primary: d.model }; else delete a.model;
        });
        if (d.model) syncModelAllowlist(c, cat);
        msg = "تم تغيير نموذج الوكيل"; break;
      }
      case "thinking.default": {
        if (!THINKING.some((t) => t.v === d.level)) throw new Error("القيمة غير صالحة");
        ((c.agents ??= {}).defaults ??= {}).thinkingDefault = d.level;
        msg = "تم حفظ مستوى التفكير"; break;
      }

      case "wa.save": {
        const wa = ((c.channels ??= {}).whatsapp ??= {});
        if (["pairing", "allowlist", "open"].includes(d.dmPolicy)) wa.dmPolicy = d.dmPolicy;
        if (["allowlist", "open", "disabled"].includes(d.groupPolicy)) wa.groupPolicy = d.groupPolicy;
        // Mention gating is a separate layer from group access.
        if (typeof d.requireMention === "boolean") {
          wa.groups ??= {};
          wa.groups["*"] = { ...(wa.groups["*"] || {}), requireMention: d.requireMention };
        }
        if (Array.isArray(d.allowFrom)) wa.allowFrom = d.allowFrom.filter(Boolean);
        if (Array.isArray(d.groupAllowFrom)) wa.groupAllowFrom = d.groupAllowFrom.filter(Boolean);
        if (typeof d.selfChatMode === "boolean") wa.selfChatMode = d.selfChatMode;
        if (wa.dmPolicy === "open" && !(wa.allowFrom || []).includes("*")) {
          wa.allowFrom = [...(wa.allowFrom || []), "*"];
        }
        msg = "تم حفظ إعدادات واتساب"; break;
      }
      case "wa.debounce": {
        const n = Number(d.ms);
        if (![0, 2000, 5000].includes(n)) throw new Error("القيمة غير صالحة");
        ((c.channels ??= {}).whatsapp ??= {}).debounceMs = n;
        msg = "تم حفظ سرعة الرد"; break;
      }
      case "wa.autoreply": {
        ((c.messages ??= {}).groupChat ??= {}).visibleReplies = d.on ? "automatic" : "message_tool";
        msg = d.on ? "سيرد تلقائيا في المجموعات" : "لن يرد إلا عندما يقرر ذلك"; break;
      }

      case "mcp.add": {
        const url = String(d.url || "").trim();
        if (!/^https?:\/\//.test(url)) throw new Error("الرابط مطلوب ويجب أن يبدأ بـ https");
        // Name is derived from the host so the user only pastes one thing.
        const base = String(d.name || "").trim() || deriveMcpName(url);
        if (!/^[a-z0-9-]{2,40}$/.test(base)) throw new Error("الاسم غير صالح");
        const servers = ((c.mcp ??= {}).servers ??= {});
        // Two hosts can derive the same slug; suffix instead of rejecting.
        let name = base;
        for (let i = 2; servers[name]; i += 1) name = `${base}-${i}`;
        const token = normalizeMcpToken(d.token);
        // OpenClaw ignores a static Authorization header while auth is "oauth",
        // so accepting both would silently drop the key just typed.
        if (d.oauth && token) throw new Error("اختر إما تسجيل الدخول أو مفتاح ثابت، وليس الاثنين");
        servers[name] = {
          url,
          // Streamable HTTP is the current MCP transport; SSE is the legacy fallback.
          transport: d.legacySse ? "sse" : "streamable-http",
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          ...(d.oauth ? { auth: "oauth" } : {}),
          ...(d.agentId && findAgent(c, d.agentId) && rosterOf(c).length > 1
            ? { codex: { agents: [d.agentId] } } : {}),
        };
        const where = classifyUrlSecret(url);
        msg = where === "query" ? `تمت إضافة ${name} — المفتاح داخل الرابط، راجع التنبيه`
          : where === "path" ? `تمت إضافة ${name} — الرابط يحتوي على مفتاح`
          : `تمت إضافة ${name}`;
        break;
      }
      case "mcp.remove": { delete c.mcp?.servers?.[d.name]; msg = "تم الحذف"; break; }
      case "mcp.enable": {
        const s = c.mcp?.servers?.[d.name];
        if (!s) throw new Error("الخادم غير موجود");
        if (d.on) delete s.enabled; else s.enabled = false;
        msg = d.on ? "تم التشغيل" : "تم الإيقاف"; break;
      }
      /* Codex decides MCP tool prompts from this per-server mode:
           auto    -> ask when the tool declares destructiveHint/openWorldHint
           prompt  -> ask every time
           approve -> pre-approved, never ask
         Codex also has a "writes" mode, but OpenClaw's schema rejects it. */
      case "mcp.approval": {
        const s = c.mcp?.servers?.[d.name];
        if (!s) throw new Error("الخادم غير موجود");
        const mode = String(d.mode || "");
        if (!["auto", "prompt", "approve"].includes(mode)) throw new Error("القيمة غير صالحة");
        if (mode === "auto") {
          if (s.codex) {
            delete s.codex.defaultToolsApprovalMode;
            if (!Object.keys(s.codex).length) delete s.codex;
          }
        } else s.codex = { ...(s.codex || {}), defaultToolsApprovalMode: mode };
        msg = "تم حفظ الأذونات"; break;
      }
      /* Grants or revokes one agent's access from that agent's own MCP page.
         Scope lives in `codex.agents`, which cannot express "nobody": an empty
         array fails config validation and dropping the key means "everyone".
         So the last agent leaving disables the server instead of clearing the
         list, and re-granting from an agent page re-enables it scoped to that
         agent alone rather than handing it back to the whole roster. */
      case "mcp.agentAccess": {
        const s = c.mcp?.servers?.[d.name];
        if (!s) throw new Error("الخادم غير موجود");
        if (!findAgent(c, d.agentId)) throw new Error("الوكيل غير موجود");
        const roster = rosterOf(c).map((a) => a.id);
        const setScope = (list) => {
          if (list.length && list.length < roster.length) {
            s.codex = { ...(s.codex || {}), agents: list };
          } else if (s.codex) {
            delete s.codex.agents;
            if (!Object.keys(s.codex).length) delete s.codex;
          }
        };
        const current = (s.codex?.agents ?? roster).filter((id) => roster.includes(id));
        if (d.on && s.enabled === false) {
          delete s.enabled;
          setScope([d.agentId]);
          msg = "تم تشغيل الخادم لهذا الوكيل وحده";
          break;
        }
        const next = d.on
          ? [...new Set([...current, d.agentId])]
          : current.filter((id) => id !== d.agentId);
        if (!next.length) {
          s.enabled = false;
          setScope(roster);
          msg = "لم يعد أي وكيل يستخدم هذا الخادم، فتم إيقافه";
          break;
        }
        setScope(next);
        msg = d.on ? "تم التشغيل لهذا الوكيل" : "تم الإيقاف لهذا الوكيل"; break;
      }

      case "skill.enable": {
        const name = String(d.name || "");
        if (!/^[a-z0-9][a-z0-9._-]{0,60}$/i.test(name)) throw new Error("الاسم غير صالح");
        const e = ((c.skills ??= {}).entries ??= {});
        if (d.on) {
          delete e[name]?.enabled;
          if (e[name] && !Object.keys(e[name]).length) delete e[name];
        } else e[name] = { ...(e[name] || {}), enabled: false };
        msg = d.on ? "تم تشغيل المهارة" : "تم إيقاف المهارة"; break;
      }

      default: throw new Error("إجراء غير معروف");
    }

    // baseHash makes a second tab's stale write fail instead of silently
    // overwriting whatever the first tab just saved.
    await store.apply(c, hash);
    return msg;
  }

  return { buildState, mutate, readFileFor };
}
