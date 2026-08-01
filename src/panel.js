import fs from "node:fs";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/* Every asset and API path in the front-end is relative, so the panel works
   under any mount prefix. That only holds while the document URL ends in a
   slash — without it the browser resolves "api/state" one level too high —
   so a bare prefix redirects before anything else runs. */
function gate(msg) {
  return `<!doctype html><html lang=ar dir=rtl><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>اكستند</title><link rel=stylesheet href="app.css"><body class=gate><div class=gate-card>
<img src="assets/extend-logo.webp" alt="" width=104><p>${msg}</p></div>`;
}

/**
 * Panel HTTP surface, mounted under `mount` (e.g. "/extend-panel").
 * `publicDir` holds the static build; `model` and `actions` do the real work.
 */
export function createPanel({ mount, publicDir, auth, model, actions, logger }) {
  const root = path.resolve(publicDir);

  return async function handle(req, res) {
    const url = new URL(req.url || "/", "http://x");
    const send = (code, body, type = "text/html; charset=utf-8", extra = {}) => {
      res.writeHead(code, { "content-type": type, ...extra });
      res.end(body);
      return true;
    };
    const json = (code, obj) => send(code, JSON.stringify(obj), "application/json");
    const readBody = () => new Promise((r) => {
      let d = "";
      req.on("data", (c) => { d += c; });
      req.on("end", () => r(d));
    });

    if (url.pathname === mount) {
      return send(302, "", "text/html", { location: mount + "/" + url.search });
    }
    const rel = url.pathname.slice(mount.length + 1);

    // Static assets are public: fonts, logos, css and js carry no account data.
    if (rel.startsWith("assets/") || rel === "app.css" || rel === "app.js") {
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
        return send(404, "not found", "text/plain");
      }
      // Fonts and logos are immutable; css/js must not survive an update.
      const longCache = /\.(woff2|png|webp|svg)$/.test(file);
      return send(200, fs.readFileSync(file), MIME[path.extname(file)] || "application/octet-stream",
        { "cache-control": longCache ? "public, max-age=604800" : "no-cache" });
    }

    const t = url.searchParams.get("t");
    if (t) {
      const claim = auth.redeem(t);
      if (!claim) return send(403, gate("انتهت صلاحية الرابط أو تم استخدامه. أرسل /extend مرة أخرى."));
      return send(302, "", "text/html", {
        location: mount + "/",
        "set-cookie": auth.cookie(claim.sub),
      });
    }

    const session = auth.read(req);
    if (!session) {
      return send(403, gate("أرسل /extend في المحادثة لفتح هذه الصفحة، واحفظ الصفحة في المفضلة."));
    }

    try {
      if (rel === "api/state") return json(200, await model.buildState());

      if (rel === "api/file") {
        return json(200, await model.readFileFor(
          url.searchParams.get("agent"), url.searchParams.get("name")));
      }

      if (rel === "api/do" && req.method === "POST") {
        const { action, data } = JSON.parse((await readBody()) || "{}");
        return json(200, { ok: true, msg: await model.mutate(action, data || {}) });
      }

      // CLI-backed work: skills, MCP OAuth, provider login.
      if (rel === "api/gw" && req.method === "POST") {
        const { action, data } = JSON.parse((await readBody()) || "{}");
        return json(200, await actions.run(action, data));
      }
    } catch (e) {
      logger?.warn?.(`[extend-panel] ${rel} failed: ${e?.message || e}`);
      return json(400, { ok: false, msg: e?.message || "حدث خطأ" });
    }

    // Slide the expiry on the app shell only; API calls stay header-free.
    const extra = auth.needsRenewal(session)
      ? { "set-cookie": auth.cookie(session.s ?? null) }
      : {};
    return send(200, fs.readFileSync(path.join(root, "index.html")), "text/html; charset=utf-8", extra);
  };
}
