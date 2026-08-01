import fs from "node:fs";
import { spawn, execFile } from "node:child_process";

/* CLI-backed actions. These shell out to `openclaw` because the work they do —
   skill eligibility, MCP OAuth handshakes, provider login — lives in the CLI
   and has no in-process API. They used to be reached over an authenticated
   loopback hop from a separate panel process; now the panel runs inside the
   gateway and calls them directly, so the panel session is the only gate. */

function runCli(args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile("openclaw", args, { timeout, maxBuffer: 8 << 20, env: process.env }, (err, stdout, stderr) => {
      const out = String(stdout || stderr || "").trim();
      resolve({
        ok: !err,
        msg: out.slice(0, 1500) || (err ? "تعذر التنفيذ" : "تم"),
        stdout: String(stdout || ""),
      });
    });
  });
}

function parseJson(text) {
  const i = text.indexOf("{");
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i)); } catch { return null; }
}

const MCP_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,60}$/i;

export function createActions() {
  let oauthChild = null;
  let oauthUrl = null;
  let skillsCache = null;

  function startOpenAiLogin() {
    return new Promise((resolve) => {
      try { oauthChild?.kill(); } catch {}
      oauthUrl = null;
      const child = spawn("openclaw", ["models", "auth", "login", "--provider", "openai"], { env: process.env });
      oauthChild = child;
      let buf = "";
      const scan = (chunk) => {
        buf += chunk.toString();
        const m = buf.match(/https:\/\/[^\s'"]+/);
        if (m && !oauthUrl) { oauthUrl = m[0]; resolve({ ok: true, url: oauthUrl }); }
      };
      child.stdout?.on("data", scan);
      child.stderr?.on("data", scan);
      child.on("exit", () => { if (!oauthUrl) resolve({ ok: false, msg: "ما طلع رابط تسجيل الدخول" }); });
      setTimeout(() => { if (!oauthUrl) resolve({ ok: false, msg: "تأخر الرد، جرب مرة ثانية" }); }, 25000);
    });
  }

  async function completeOpenAiLogin(callbackUrl) {
    if (!oauthChild) return { ok: false, msg: "ابدأ العملية اول" };
    let u;
    try { u = new URL(String(callbackUrl)); } catch { return { ok: false, msg: "الرابط غير صحيح" }; }
    // The browser redirect targets the operator's own machine; replay it against
    // the listener the CLI opened here, keeping port/path/query intact.
    u.hostname = "127.0.0.1";
    u.protocol = "http:";
    try {
      const r = await fetch(u.toString(), { redirect: "manual" });
      await new Promise((res) => setTimeout(res, 2500));
      const done = oauthChild.exitCode !== null;
      return { ok: r.status < 500, msg: done ? "تم الربط بنجاح" : "ارسلنا الرابط، تحقق من حالة الاتصال" };
    } catch (e) { return { ok: false, msg: "تعذر تنفيذ الرابط: " + (e?.message || "") }; }
  }

  /* Skill eligibility (missing binaries, allowlists, agent filters) is computed
     by the CLI, so the panel cannot derive it from the filesystem alone. */
  async function skillsList(force) {
    if (!force && skillsCache && Date.now() - skillsCache.at < 30000) return skillsCache.value;
    const r = await runCli(["skills", "list", "--json"], 60000);
    const d = parseJson(r.stdout);
    if (!d?.skills) return { ok: false, msg: "تعذر قراءة المهارات" };
    const value = {
      ok: true,
      workspaceDir: d.workspaceDir || "",
      managedSkillsDir: d.managedSkillsDir || "",
      skills: d.skills.map((s) => ({
        name: s.name,
        description: s.description || "",
        emoji: s.emoji || "",
        eligible: s.eligible === true,
        disabled: s.disabled === true,
        bundled: s.bundled === true,
        source: s.source || "",
        homepage: s.homepage || "",
        missing: [
          ...(s.missing?.bins || []).map((b) => `برنامج ${b}`),
          ...(s.missing?.env || []).map((e) => `متغير ${e}`),
          ...(s.missing?.config || []).map((c) => `اعداد ${c}`),
        ],
        platformIncompatible: s.platformIncompatible === true,
      })),
    };
    skillsCache = { at: Date.now(), value };
    return value;
  }

  async function skillsSearch(query) {
    const q = String(query || "").trim().slice(0, 60);
    const r = await runCli(["skills", "search", ...(q ? [q] : []), "--limit", "12", "--json"], 45000);
    const d = parseJson(r.stdout);
    if (!d?.results) return { ok: false, msg: "تعذر البحث. تأكد من الاتصال بالانترنت." };
    return {
      ok: true,
      results: d.results.map((s) => ({
        ref: s.install?.reference || `${s.ownerHandle}/${s.slug}`,
        name: s.displayName || s.slug,
        summary: (s.summary || "").slice(0, 160),
        owner: s.ownerHandle || "",
        downloads: s.downloads || 0,
        official: s.official === true,
      })),
    };
  }

  async function skillsInstall(ref) {
    const raw = String(ref || "");
    if (!/^[A-Za-z0-9._@/-]{3,80}$/.test(raw)) return { ok: false, msg: "مرجع غير صالح" };
    // ClawHub search returns bare "owner/slug"; the CLI only accepts "@owner/slug".
    const spec = /^(@|git:|skills-sh:|\.)/.test(raw) ? raw : "@" + raw;
    // --global installs into the shared managed dir so every agent can see it.
    // Community skills flagged risky are intentionally NOT auto-acknowledged:
    // the operator has to review and install those from the CLI themselves.
    const r = await runCli(["skills", "install", spec, "--global"], 180000);
    skillsCache = null;
    if (r.ok) return { ok: true, msg: "تم تثبيت المهارة" };
    const risky = /risk|acknowledge|review/i.test(r.msg);
    return {
      ok: false,
      msg: risky
        ? "هذي مهارة من المجتمع وتحتاج مراجعة يدوية قبل التثبيت. ثبتها من سطر الاوامر لو متأكد منها."
        : r.msg,
    };
  }

  /** Returns the on-disk directory only when it is a removable (non-bundled) skill. */
  async function skillDir(name) {
    if (!MCP_NAME_RE.test(String(name || ""))) return null;
    const r = await runCli(["skills", "info", String(name), "--json"], 45000);
    const d = parseJson(r.stdout);
    if (!d || d.bundled === true || !d.baseDir) return null;
    return d.baseDir;
  }

  async function skillsRemove(name) {
    const dir = await skillDir(name);
    if (!dir) return { ok: false, msg: "ما ينفع تحذف هذي المهارة" };
    try { fs.rmSync(dir, { recursive: true, force: true }); }
    catch (e) { return { ok: false, msg: e?.message || "تعذر الحذف" }; }
    skillsCache = null;
    return { ok: true, msg: "تم حذف المهارة" };
  }

  /* `openclaw mcp login <name>` prints an authorization URL and parks a PKCE
     verifier in SQLite; rerunning it with --code finishes the exchange. Tokens
     land in the shared state DB, never in openclaw.json. */
  async function mcpLoginStart(name) {
    if (!MCP_NAME_RE.test(String(name || ""))) return { ok: false, msg: "اسم غير صالح" };
    const r = await runCli(["mcp", "login", String(name)], 90000);
    const url = r.msg.match(/https:\/\/[^\s"']+/)?.[0];
    if (!url) return { ok: false, msg: r.msg || "تعذر بدء تسجيل الدخول" };
    return { ok: true, url };
  }

  async function mcpLoginComplete(name, codeOrUrl) {
    if (!MCP_NAME_RE.test(String(name || ""))) return { ok: false, msg: "اسم غير صالح" };
    // Users paste the whole failed redirect; pull the code out for them.
    const raw = String(codeOrUrl || "").trim();
    let code = raw;
    if (/^https?:\/\//i.test(raw)) {
      try { code = new URL(raw).searchParams.get("code") || ""; } catch { code = ""; }
    }
    if (!code || !/^[\w.~-]{4,512}$/.test(code)) {
      return { ok: false, msg: "لم نجد رمز التفويض في ما ألصقته" };
    }
    const r = await runCli(["mcp", "login", String(name), "--code", code], 90000);
    if (r.ok) return { ok: true, msg: "تم ربط الخادم بنجاح" };
    // The CLI failure text is English and stack-flavored; translate common cases.
    const m = r.msg;
    const friendly = /invalid authorization code|invalid_grant/i.test(m)
        ? "الرمز غير صالح أو انتهت صلاحيته. ابدأ تسجيل الدخول من جديد."
      : /expired/i.test(m) ? "انتهت صلاحية الطلب. ابدأ تسجيل الدخول من جديد."
      : /not found|unknown server/i.test(m) ? "الخادم غير موجود."
      : "تعذر إكمال الربط. ابدأ تسجيل الدخول من جديد.";
    return { ok: false, msg: friendly };
  }

  async function mcpLogout(name) {
    if (!MCP_NAME_RE.test(String(name || ""))) return { ok: false, msg: "اسم غير صالح" };
    const r = await runCli(["mcp", "logout", String(name)], 45000);
    return r.ok ? { ok: true, msg: "تم إلغاء الربط" } : { ok: false, msg: r.msg };
  }

  /** Static check only — never opens a connection to the remote server. */
  async function mcpStatus(name) {
    if (!MCP_NAME_RE.test(String(name || ""))) return { ok: false, msg: "اسم غير صالح" };
    const r = await runCli(["mcp", "doctor", String(name)], 45000);
    return { ok: r.ok, msg: r.msg };
  }

  const handlers = {
    "openai.start": () => startOpenAiLogin(),
    "openai.complete": (d) => completeOpenAiLogin(d?.callbackUrl),
    "wa.link": () => runCli(["channels", "status", "whatsapp"]),
    "skills.list": (d) => skillsList(d?.force === true),
    "skills.search": (d) => skillsSearch(d?.query),
    "skills.install": (d) => skillsInstall(d?.ref),
    "skills.remove": (d) => skillsRemove(d?.name),
    "mcp.login": (d) => mcpLoginStart(d?.name),
    "mcp.loginComplete": (d) => mcpLoginComplete(d?.name, d?.code),
    "mcp.logout": (d) => mcpLogout(d?.name),
    "mcp.status": (d) => mcpStatus(d?.name),
  };

  return {
    async run(action, data) {
      const fn = handlers[action];
      if (!fn) return { ok: false, msg: "إجراء غير معروف" };
      return await fn(data || {});
    },
  };
}
