import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createActions } from "./src/actions.js";
import { createAuth } from "./src/auth.js";
import { createConfigStore, createModel } from "./src/model.js";
import { createPanel } from "./src/panel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* Hostinger's OpenClaw image fronts the gateway with a proxy that requires a
   token login on every path except `/hooks/*`, which it forwards unauthenticated
   so channel webhooks work. Mounting there is what makes a chat link openable on
   a phone without a second login. Harmless elsewhere: the gateway serves plugin
   routes at whatever path they claim. Override with `mountPath` if a channel
   ever wants this exact sub-path. */
const DEFAULT_MOUNT = "/hooks/extend-panel";

const dataDir = () =>
  process.env.OPENCLAW_DATA_DIR || path.join(os.homedir(), ".openclaw");
const codexDir = () =>
  process.env.CODEX_HOME || path.join(os.homedir(), ".codex");

/* The chat link has to be an address the operator's phone can reach. The
   gateway does not know how it is exposed to the outside world, so a reverse
   proxy or tunnel needs `panelUrl`. Falling back to the loopback address is
   correct for a local install and obviously wrong everywhere else, which is
   the point: a link to 127.0.0.1 tells the operator to set panelUrl. */
function publicBase(api) {
  const configured = api?.pluginConfig?.panelUrl;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim().replace(/\/+$/, "");
  }
  const port = api?.config?.gateway?.port ?? 18789;
  return `http://127.0.0.1:${port}`;
}

export default definePluginEntry({
  id: "extend-panel",
  name: "Extend Panel",
  description: "Arabic-first mobile control panel, opened from a private chat link.",
  register(api) {
    const cfg = api.pluginConfig || {};
    const auth = createAuth({
      gatewayToken: () => api.config?.gateway?.auth?.token || "",
      linkTtlMs: Math.round((cfg.linkTtlMinutes ?? 15) * 60 * 1000),
      sessionTtlMs: Math.round((cfg.sessionDays ?? 30) * 24 * 60 * 60 * 1000),
    });
    const model = createModel({
      store: createConfigStore({ configPath: path.join(dataDir(), "openclaw.json") }),
      dataDir: dataDir(),
      codexDir: codexDir(),
    });
    const mount = typeof cfg.mountPath === "string" && cfg.mountPath.startsWith("/")
      ? cfg.mountPath.replace(/\/+$/, "")
      : DEFAULT_MOUNT;
    const handle = createPanel({
      mount,
      publicDir: path.join(HERE, "public"),
      auth,
      model,
      actions: createActions(),
      logger: api.logger,
    });

    api.registerCommand({
      name: "extend",
      description: "Get a private link to manage your agents.",
      acceptsArgs: false,
      exposeSenderIsOwner: true,
      handler: async (ctx) => {
        if (ctx.isAuthorizedSender === false || ctx.senderIsOwner === false) {
          return { text: "Only the owner can open the control panel." };
        }
        let token;
        try { token = auth.mintLink(ctx.senderId); }
        catch { return { text: "Set a gateway auth token first, then try again." }; }
        const minutes = cfg.linkTtlMinutes ?? 15;
        return {
          text: `Open this private link (expires in ${minutes} minutes, works once):\n\n`
            + `${publicBase(api)}${mount}/?t=${token}\n\n`
            + "Don't forward it — it opens your control panel.",
        };
      },
    });

    // auth: "plugin" because the panel owns its own session cookie; the gateway
    // must not demand an operator token for a link opened on someone's phone.
    api.registerHttpRoute({
      path: mount,
      match: "prefix",
      auth: "plugin",
      handler: handle,
    });
  },
});
