const PKG = new URL("..", import.meta.url).pathname;
const entry = (await import(`${PKG}/index.js`)).default;
const manifest = JSON.parse((await import("node:fs")).readFileSync(`${PKG}/openclaw.plugin.json`, "utf8"));
const pkg = JSON.parse((await import("node:fs")).readFileSync(`${PKG}/package.json`, "utf8"));

let pass = 0, fail = 0;
const t = (n, ok, x = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`); };

t("entry id matches manifest", entry.id === manifest.id, `${entry.id} / ${manifest.id}`);
t("package declares the entry", pkg.openclaw?.extensions?.[0] === "./index.js");
t("package name is the ClawHub scope", pkg.name === "@khaled-harthi/extend-panel", pkg.name);
t("manifest scope matches owner khaled-harthi", pkg.name.startsWith("@khaled-harthi/"));

/* compat.pluginApi gates install (src/plugins/install-shared.ts); an invalid
   shape aborts discovery entirely, so assert the exact contract. */
const compat = pkg.openclaw?.compat;
const build = pkg.openclaw?.build;
t("compat.pluginApi present", typeof compat?.pluginApi === "string" && compat.pluginApi.trim().length > 0, compat?.pluginApi);
t("compat.pluginApi is a semver floor", /^>=\d{4}\.\d+\.\d+$/.test(compat?.pluginApi || ""), compat?.pluginApi);
t("build.openclawVersion present", typeof build?.openclawVersion === "string", build?.openclawVersion);
t("build.openclawVersion is a bare version", /^\d{4}\.\d+\.\d+$/.test(build?.openclawVersion || ""), build?.openclawVersion);
// A floor above the build version would refuse to install on the host it was
// built against; a floor above the deploy target locks that target out.
const cmp = (v) => v.split(".").map(Number);
const le = (a, b) => { const [x, y] = [cmp(a), cmp(b)]; for (let i = 0; i < 3; i += 1) { if (x[i] !== y[i]) return x[i] < y[i]; } return true; };
t("floor is not above the build version",
  le(compat.pluginApi.replace(">=", ""), build.openclawVersion),
  `${compat.pluginApi} vs built ${build.openclawVersion}`);
t("floor admits the 2026.7.1 deploy target", le(compat.pluginApi.replace(">=", ""), "2026.7.1"), compat.pluginApi);

const routes = [], commands = [];
entry.register({
  id: manifest.id,
  config: { gateway: { auth: { token: "tok" }, port: 18789 } },
  pluginConfig: {},
  runtime: { gateway: { request: async () => ({ config: {}, hash: "h" }) } },
  logger: { warn: () => {}, info: () => {} },
  registerCommand: (c) => commands.push(c),
  registerHttpRoute: (r) => routes.push(r),
});

t("registers exactly one command", commands.length === 1, commands.map((c) => c.name).join(","));
t("command is /extend", commands[0]?.name === "extend");
t("command matches manifest alias", commands[0]?.name === manifest.commandAliases[0].name);
t("registers exactly one route", routes.length === 1);
/* Hostinger's proxy only forwards /hooks/* without its own token login, so this
   default is what makes a chat link openable on a phone. Changing it silently
   breaks every Hostinger install. */
t("route mounts under /hooks", routes[0]?.path === "/hooks/extend-panel", routes[0]?.path);
t("route is prefix-matched", routes[0]?.match === "prefix");
t("route owns its own auth", routes[0]?.auth === "plugin");
t("route handler is callable", typeof routes[0]?.handler === "function");

// owner gate
const deny = await commands[0].handler({ senderIsOwner: false, senderId: "x" });
t("non-owner is refused a link", /Only the owner/.test(deny.text), deny.text);
const ok = await commands[0].handler({ senderIsOwner: true, senderId: "+1555" });
t("owner gets a mounted link", ok.text.includes("/extend-panel/?t="), ok.text.split("\n").find((l) => l.includes("http")));
t("link warns against forwarding", /forward/i.test(ok.text));
t("link points at the same mount", ok.text.includes("/hooks/extend-panel/?t="));

// no gateway token -> no link rather than a broken one
const noTok = { ...entry };
const cmds2 = [];
noTok.register({
  id: manifest.id, config: { gateway: {} }, pluginConfig: {},
  runtime: { gateway: { request: async () => ({}) } }, logger: {},
  registerCommand: (c) => cmds2.push(c), registerHttpRoute: () => {},
});
const noLink = await cmds2[0].handler({ senderIsOwner: true, senderId: "x" });
t("missing gateway token is handled", /token/i.test(noLink.text), noLink.text);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
