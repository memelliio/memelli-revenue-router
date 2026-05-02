// Auth helper. Two acceptable presenters:
//   1) Bearer <INTERNAL_SERVICE_TOKEN>   — server-to-server (default)
//   2) Bearer <operator JWT>             — when JWT_SECRET set + token verifies (testing)
// On report/* endpoints either form is accepted.

import type { FastifyRequest, FastifyReply } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";

function bearerOf(req: FastifyRequest): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function constantEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function verifyJwtHs256(token: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [h, p, s] = parts;
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  if (!constantEq(s, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) return false;
  } catch { return false; }
  return true;
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const token = bearerOf(req);
  if (!token) { reply.code(401).send({ error: "missing bearer" }); return false; }
  const internal = process.env.INTERNAL_SERVICE_TOKEN;
  if (internal && constantEq(token, internal)) return true;
  const jwt = process.env.JWT_SECRET;
  if (jwt && verifyJwtHs256(token, jwt)) return true;
  reply.code(401).send({ error: "invalid bearer" });
  return false;
}
