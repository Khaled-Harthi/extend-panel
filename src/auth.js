import crypto from "node:crypto";

/* Both the one-time chat link and the session cookie derive their key from the
   gateway token, so rotating that token invalidates every outstanding link and
   signs every browser out. That is the only revocation lever, and it is enough
   for a single-operator panel.

   Sessions are stateless on purpose: a gateway restart must not sign anyone
   out, because on a broken WhatsApp the chat link is unreachable and a
   bookmarked session is the only way back in. */

const usedNonces = new Map();

const sign = (key, body) => {
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", key).update(payload).digest("base64url")}`;
};

function verify(key, token) {
  const [payload, mac] = String(token || "").split(".");
  if (!payload || !mac) return null;
  let expect;
  try { expect = crypto.createHmac("sha256", key).update(payload).digest("base64url"); } catch { return null; }
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try { body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
  return body?.exp && Date.now() < body.exp ? body : null;
}

/**
 * Link and session tokens for one gateway.
 * `gatewayToken` is read lazily so a rotated token takes effect without a restart.
 */
export function createAuth({ gatewayToken, linkTtlMs, sessionTtlMs }) {
  const derive = (label) => {
    const t = gatewayToken();
    if (!t) throw new Error("gateway token unavailable");
    return crypto.createHash("sha256").update(label + "|" + t).digest();
  };
  // Renew once a session is a quarter through its life so daily users never
  // hit the wall, without setting a cookie on every single page load.
  const renewAfter = sessionTtlMs / 4;

  return {
    mintLink(subject) {
      return sign(derive("extend-link"), {
        n: crypto.randomBytes(12).toString("base64url"),
        exp: Date.now() + linkTtlMs,
        s: subject || null,
      });
    },

    /** Redeems a one-time link and returns its subject, or null. */
    redeem(token) {
      let body;
      try { body = verify(derive("extend-link"), token); } catch { return null; }
      // Nonces are in-memory: a restart can let an unexpired link be reused
      // once. Acceptable — links are short-lived and go to one chat thread.
      if (!body?.n || usedNonces.has(body.n)) return null;
      usedNonces.set(body.n, body.exp);
      for (const [n, e] of usedNonces) if (e < Date.now()) usedNonces.delete(n);
      return { sub: body.s ?? null };
    },

    cookie(subject) {
      const token = sign(derive("extend-session"), { s: subject ?? null, exp: Date.now() + sessionTtlMs });
      return `s=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}`;
    },

    read(req) {
      const raw = (req.headers.cookie || "").split(";").map((s) => s.trim())
        .find((s) => s.startsWith("s="))?.slice(2);
      if (!raw) return null;
      try { return verify(derive("extend-session"), raw); } catch { return null; }
    },

    needsRenewal(session) {
      return session.exp - Date.now() < sessionTtlMs - renewAfter;
    },
  };
}
