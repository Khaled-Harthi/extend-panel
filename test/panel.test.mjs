import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import net from "node:net";

const PKG = new URL("..", import.meta.url).pathname;
const { createAuth } = await import(`${PKG}/src/auth.js`);
const { createConfigStore, createModel, rosterOf, setRoster } = await import(`${PKG}/src/model.js`);
const { createPanel } = await import(`${PKG}/src/panel.js`);

const MOUNT = "/extend-panel";
const PORT = 18393;
const TOKEN = "testtoken123";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extpanel-"));
const CFG = path.join(dir, "openclaw.json");

const read = () => JSON.parse(fs.readFileSync(CFG, "utf8"));
const write = (c) => fs.writeFileSync(CFG, JSON.stringify(c, null, 2));
const hashOf = (c) => crypto.createHash("sha256").update(JSON.stringify(c)).digest("hex");

/* Stub gateway: mirrors the two RPCs the panel uses, including the baseHash
   guard, so a stale write fails here exactly as it would in production. */
let applyCalls = [];
const runtime = {
  gateway: {
    request: async (method, params) => {
      if (method === "config.get") return { config: read(), hash: hashOf(read()) };
      if (method === "config.apply") {
        applyCalls.push(params);
        if (typeof params.raw !== "string" || !params.raw.trim()) throw new Error("raw required");
        const next = JSON.parse(params.raw); // must be valid JSON or this throws
        if (params.baseHash && params.baseHash !== hashOf(read())) {
          throw new Error("config changed since it was read");
        }
        write(next);
        return { ok: true };
      }
      throw new Error("unexpected method " + method);
    },
  },
};

const baseCfg = (roster, servers = {}, shape = "entries") => {
  const agents = shape === "list"
    ? { list: roster.map((id, i) => ({ id, ...(i === 0 ? { default: true } : {}) })) }
    : { entries: Object.fromEntries(roster.map((id, i) => [id, i === 0 ? { default: true } : {}])) };
  return { gateway: { auth: { token: TOKEN } }, agents, mcp: { servers } };
};

write(baseCfg(["main", "saqr"]));

const auth = createAuth({ gatewayToken: () => read().gateway?.auth?.token || "", linkTtlMs: 9e5, sessionTtlMs: 30 * 864e5 });
const model = createModel({ store: createConfigStore(runtime), dataDir: dir, codexDir: path.join(dir, "codex") });
const handle = createPanel({
  mount: MOUNT, publicDir: path.join(PKG, "public"), auth, model,
  actions: { run: async (a) => ({ ok: true, msg: "stub " + a }) },
  logger: { warn: () => {} },
});
const server = http.createServer((req, res) => handle(req, res));
await new Promise((r) => server.listen(PORT, r));

const B = `http://127.0.0.1:${PORT}`;
const get = (p, cookie) => fetch(B + p, { redirect: "manual", headers: cookie ? { cookie } : {} });
const post = (p, body, cookie) => fetch(B + p, {
  method: "POST", redirect: "manual",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});
const link = () => auth.mintLink("tester");

let pass = 0, fail = 0;
const t = (name, ok, extra = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- mount + static ---------- */
let r = await get(MOUNT);
t("bare mount redirects to trailing slash", r.status === 302 && r.headers.get("location") === MOUNT + "/", r.headers.get("location"));
r = await get(`${MOUNT}/app.css`);
t("css served without a session", r.status === 200 && (await r.text()).includes("Noto Naskh Arabic"));
r = await get(`${MOUNT}/assets/fonts/NotoNaskhArabic.woff2`);
t("font served", r.status === 200 && r.headers.get("cache-control")?.includes("604800"));
/* fetch() normalizes "..", so a raw request line is the only way to actually
   put a traversal on the wire and prove the static handler rejects it. */
const rawGet = (line) => new Promise((resolve) => {
  const sock = net.connect(PORT, "127.0.0.1", () => {
    sock.write(`GET ${line} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
  });
  let buf = "";
  sock.on("data", (d) => { buf += d.toString(); });
  sock.on("end", () => resolve(buf));
  sock.on("error", () => resolve(""));
});
for (const evil of [
  `${MOUNT}/assets/../../../../etc/passwd`,
  `${MOUNT}/assets/..%2f..%2f..%2f..%2fetc%2fpasswd`,
  `${MOUNT}/assets/....//....//etc/passwd`,
]) {
  const body = await rawGet(evil);
  t(`traversal blocked: ${evil.slice(MOUNT.length)}`,
    !body.includes("root:") && !/^HTTP\/1\.1 200/.test(body), body.split("\r\n")[0] || "no response");
}
r = await get(`${MOUNT}/`);
t("no session is gated", r.status === 403);

/* ---------- session ---------- */
r = await get(`${MOUNT}/?t=${link()}`);
const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
t("link redirects into the mount", r.status === 302 && r.headers.get("location") === MOUNT + "/");
t("cookie is 30 days + hardened", /Max-Age=2592000/.test(r.headers.get("set-cookie") || "")
  && /HttpOnly/.test(r.headers.get("set-cookie") || "") && /Secure/.test(r.headers.get("set-cookie") || ""));
const once = link();
await get(`${MOUNT}/?t=${once}`);
r = await get(`${MOUNT}/?t=${once}`);
t("link is single-use", r.status === 403);
r = await get(`${MOUNT}/`, cookie);
t("cookie grants the shell", r.status === 200 && (await r.text()).includes('src="app.js"'));
r = await get(`${MOUNT}/`, "s=forged.aaaa");
t("forged cookie rejected", r.status === 403);

/* ---------- state ---------- */
r = await get(`${MOUNT}/api/state`, cookie);
let st = await r.json();
t("state lists agents from entries shape", r.status === 200 && eq(st.agents.map((a) => a.id), ["main", "saqr"]), JSON.stringify(st.agents?.map((a) => a.id)));
t("default agent flagged", st.agents[0].isMain === true && st.agents[1].isMain === false);

/* ---------- mutations write through config.apply ---------- */
applyCalls = [];
r = await post(`${MOUNT}/api/do`, { action: "agent.rename", data: { id: "saqr", name: "صقر" } }, cookie);
t("rename ok", (await r.json()).ok === true);
t("apply got a baseHash", applyCalls.length === 1 && typeof applyCalls[0].baseHash === "string");
t("rename persisted into entries", read().agents.entries.saqr.name === "صقر", JSON.stringify(read().agents.entries));
t("entries shape preserved", !read().agents.list && !!read().agents.entries);

/* stale write must lose */
const store = createConfigStore(runtime);
const snap = await store.get();
write({ ...read(), marker: "changed-by-someone-else" });
let stale = null;
try { await store.apply(snap.config, snap.hash); } catch (e) { stale = e.message; }
t("stale baseHash is rejected", Boolean(stale), stale || "no error");
t("other writer's change survived", read().marker === "changed-by-someone-else");

/* ---------- roster: legacy list shape ---------- */
write(baseCfg(["main", "saqr"], {}, "list"));
r = await get(`${MOUNT}/api/state`, cookie);
st = await r.json();
t("state reads legacy list shape", eq(st.agents.map((a) => a.id), ["main", "saqr"]));
await post(`${MOUNT}/api/do`, { action: "agent.rename", data: { id: "saqr", name: "Saqr" } }, cookie);
t("legacy list shape preserved on write", Array.isArray(read().agents.list) && !read().agents.entries,
  JSON.stringify(Object.keys(read().agents)));
t("rename persisted into list", read().agents.list.find((a) => a.id === "saqr").name === "Saqr");
await post(`${MOUNT}/api/do`, { action: "agent.main", data: { id: "saqr" } }, cookie);
t("default marker moved in list shape",
  read().agents.list.find((a) => a.id === "saqr").default === true
  && !read().agents.list.find((a) => a.id === "main").default);

/* ---------- mcp scope semantics ---------- */
const scopeOf = (n) => { const s = read().mcp.servers[n]; return { agents: s.codex?.agents ?? null, enabled: s.enabled !== false }; };
const access = (name, agentId, on) => post(`${MOUNT}/api/do`, { action: "mcp.agentAccess", data: { name, agentId, on } }, cookie).then((x) => x.json());

write(baseCfg(["main", "saqr"], { shared: { url: "https://x/mcp" } }));
await access("shared", "saqr", false);
t("mcp: off for one scopes to the other", eq(scopeOf("shared"), { agents: ["main"], enabled: true }), JSON.stringify(scopeOf("shared")));
let res = await access("shared", "main", false);
t("mcp: last agent off disables rather than erroring", eq(scopeOf("shared"), { agents: null, enabled: false }) && res.ok);
await access("shared", "saqr", true);
t("mcp: re-grant scopes to that agent alone", eq(scopeOf("shared"), { agents: ["saqr"], enabled: true }));
await access("shared", "main", true);
t("mcp: granting everyone drops the scope key", eq(scopeOf("shared"), { agents: null, enabled: true }));

write(baseCfg(["main", "saqr"], { only: { url: "https://y/mcp", codex: { agents: ["saqr"] } } }));
await access("only", "saqr", false);
t("mcp: scoped-to-one disables and leaves no empty codex", eq(scopeOf("only"), { agents: null, enabled: false })
  && read().mcp.servers.only.codex === undefined);

res = await access("ghostserver", "main", false);
t("mcp: unknown server rejected", res.ok === false, res.msg);
res = await access("only", "ghost", false);
t("mcp: unknown agent rejected", res.ok === false, res.msg);

/* ---------- mcp add: token hygiene ---------- */
write(baseCfg(["main"], {}));
const add = (data) => post(`${MOUNT}/api/do`, { action: "mcp.add", data }, cookie).then((x) => x.json());
res = await add({ url: "https://mcp.notion.com/mcp", token: "sk-abc123" });
t("mcp.add derives a name from the host", res.ok && !!read().mcp.servers.notion, JSON.stringify(Object.keys(read().mcp.servers)));
t("mcp.add writes a bearer header", read().mcp.servers.notion.headers.Authorization === "Bearer sk-abc123");
res = await add({ url: "https://mcp.notion.com/mcp", token: "key with spaces and text" });
t("mcp.add rejects a key with whitespace", res.ok === false, res.msg);
res = await add({ url: "https://mcp.notion.com/mcp", token: "sk-x", oauth: true });
t("mcp.add rejects oauth + static key together", res.ok === false, res.msg);
res = await add({ url: "https://mcp.notion.com/mcp" });
t("mcp.add uniquifies a colliding name", res.ok && !!read().mcp.servers["notion-2"], JSON.stringify(Object.keys(read().mcp.servers)));

/* ---------- url secret classification ---------- */
write(baseCfg(["main"], {
  q: { url: "https://x.com/mcp?token=abc123def456" },
  p: { url: "https://actions.zapier.com/mcp/sk1a2b3c4d5e6f7g8h9i0j/sse" },
  n: { url: "https://mcp.example.com/server/mcp" },
}));
st = await (await get(`${MOUNT}/api/state`, cookie)).json();
const byName = Object.fromEntries(st.mcp.map((m) => [m.name, m]));
t("query secret classified", byName.q.secretIn === "query" && byName.q.url.includes("***"), byName.q.url);
t("path secret classified", byName.p.secretIn === "path" && byName.p.url.includes("***"), byName.p.url);
t("clean url not flagged", byName.n.secretIn === "none" && !byName.n.url.includes("***"), byName.n.url);

/* ---------- file guard ---------- */
write(baseCfg(["main"]));
const fileGet = (agent, name) => get(`${MOUNT}/api/file?agent=${agent}&name=${encodeURIComponent(name)}`, cookie);
r = await fileGet("main", "AGENTS.md");
t("known agent file readable", r.status === 200 && (await r.json()).ok === true);
for (const bad of ["../openclaw.json", "memory/../../openclaw.json", "/etc/passwd", "secrets.md"]) {
  r = await fileGet("main", bad);
  const j = await r.json();
  t(`file guard rejects ${bad}`, j.ok !== true, j.msg);
}

/* ---------- unknown action ---------- */
r = await post(`${MOUNT}/api/do`, { action: "nope", data: {} }, cookie);
t("unknown action rejected", (await r.json()).ok === false);

server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
