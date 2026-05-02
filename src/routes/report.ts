// /report/* callbacks. Auth: INTERNAL_SERVICE_TOKEN (or operator JWT for testing).

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireAuth } from "../lib/auth.js";

async function logEvent(pool: Pool, buildId: string, team: string | null, eventType: string, payload: unknown) {
  await pool.query(
    `INSERT INTO rb_product_events (build_id, team, event_type, payload) VALUES ($1::uuid, $2, $3, $4::jsonb)`,
    [buildId, team, eventType, JSON.stringify(payload ?? {})]
  );
}

async function ensureProduct(pool: Pool, buildId: string): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM rb_products WHERE build_id = $1::uuid`, [buildId]);
  return Boolean(r.rows[0]);
}

export function registerReportRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/report/:buildId/asset-ready", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { buildId } = req.params as { buildId: string };
    if (!(await ensureProduct(pool, buildId))) return reply.code(404).send({ ok: false, error: "build_not_found" });
    const b = req.body as { team?: string; slot?: string; url?: string; external_id?: string; marketplace?: string; meta?: unknown };
    if (!b.team || !b.slot || !b.url) return reply.code(400).send({ ok: false, error: "team+slot+url required" });
    const r = await pool.query<{ id: string }>(
      `INSERT INTO rb_product_assets (build_id, team, slot, marketplace, url, external_id, meta)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
      [buildId, b.team, b.slot, b.marketplace ?? null, b.url, b.external_id ?? null, JSON.stringify(b.meta ?? {})]
    );
    await logEvent(pool, buildId, b.team, "asset_ready", { slot: b.slot, url: b.url, marketplace: b.marketplace });
    return reply.code(201).send({ ok: true, asset_id: r.rows[0].id });
  });

  app.post("/report/:buildId/listing-live", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { buildId } = req.params as { buildId: string };
    if (!(await ensureProduct(pool, buildId))) return reply.code(404).send({ ok: false, error: "build_not_found" });
    const b = req.body as { team?: string; slot?: string; url?: string; external_id?: string; marketplace?: string; meta?: unknown };
    if (!b.team || !b.slot || !b.url || !b.marketplace)
      return reply.code(400).send({ ok: false, error: "team+slot+url+marketplace required" });
    const r = await pool.query<{ id: string }>(
      `INSERT INTO rb_product_assets (build_id, team, slot, marketplace, url, external_id, meta)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
      [buildId, b.team, b.slot, b.marketplace, b.url, b.external_id ?? null, JSON.stringify(b.meta ?? {})]
    );
    await logEvent(pool, buildId, b.team, "listing_live", { marketplace: b.marketplace, url: b.url, slot: b.slot });
    return reply.code(201).send({ ok: true, listing_id: r.rows[0].id });
  });

  app.post("/report/:buildId/campaign-state", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { buildId } = req.params as { buildId: string };
    if (!(await ensureProduct(pool, buildId))) return reply.code(404).send({ ok: false, error: "build_not_found" });
    const b = req.body as { team?: string; channel?: string; state?: string; cadence?: string; meta?: unknown };
    if (!b.team || !b.channel || !b.state) return reply.code(400).send({ ok: false, error: "team+channel+state required" });
    const r = await pool.query<{ id: string }>(
      `INSERT INTO rb_product_marketing (build_id, channel, team, state, cadence, meta, last_event_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, NOW())
       ON CONFLICT ON CONSTRAINT rb_product_marketing_build_channel_team_key DO UPDATE SET
         state = EXCLUDED.state, cadence = EXCLUDED.cadence, meta = EXCLUDED.meta, last_event_at = NOW()
       RETURNING id`,
      [buildId, b.channel, b.team, b.state, b.cadence ?? null, JSON.stringify(b.meta ?? {})]
    ).catch(async (err) => {
      // Fallback when constraint name differs — fall back to plain insert
      if (/rb_product_marketing_build_channel_team_key/.test(String(err.message))) {
        return pool.query<{ id: string }>(
          `INSERT INTO rb_product_marketing (build_id, channel, team, state, cadence, meta, last_event_at)
           VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, NOW()) RETURNING id`,
          [buildId, b.channel, b.team, b.state, b.cadence ?? null, JSON.stringify(b.meta ?? {})]
        );
      }
      throw err;
    });
    await logEvent(pool, buildId, b.team, "campaign_state", { channel: b.channel, state: b.state, cadence: b.cadence });
    return reply.code(201).send({ ok: true, marketing_id: r.rows[0].id });
  });

  app.post("/report/:buildId/login-issued", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { buildId } = req.params as { buildId: string };
    if (!(await ensureProduct(pool, buildId))) return reply.code(404).send({ ok: false, error: "build_not_found" });
    const b = req.body as { role?: string; email?: string; username?: string; url?: string; meta?: unknown };
    if (!b.role) return reply.code(400).send({ ok: false, error: "role required" });
    const r = await pool.query<{ id: string }>(
      `INSERT INTO rb_product_logins (build_id, role, email, username, url, meta)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
      [buildId, b.role, b.email ?? null, b.username ?? null, b.url ?? null, JSON.stringify(b.meta ?? {})]
    );
    await logEvent(pool, buildId, "router", "login_issued", { role: b.role, email: b.email, username: b.username });
    return reply.code(201).send({ ok: true, login_id: r.rows[0].id });
  });

  app.post("/report/:buildId/job-event", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { buildId } = req.params as { buildId: string };
    if (!(await ensureProduct(pool, buildId))) return reply.code(404).send({ ok: false, error: "build_not_found" });
    const b = req.body as { standalone?: string; team?: string; status?: string; meta?: unknown };
    if (!b.standalone || !b.team || !b.status)
      return reply.code(400).send({ ok: false, error: "standalone+team+status required" });
    // Upsert by (build_id, standalone, team)
    const existing = await pool.query<{ job_id: string }>(
      `SELECT job_id FROM rb_product_jobs WHERE build_id = $1::uuid AND standalone = $2 AND team = $3 LIMIT 1`,
      [buildId, b.standalone, b.team]
    );
    let jobId: string;
    if (existing.rows[0]) {
      jobId = existing.rows[0].job_id;
      await pool.query(
        `UPDATE rb_product_jobs SET status = $1, last_event_at = NOW(),
           finished_at = CASE WHEN $1 IN ('done','failed','succeeded','cancelled') THEN NOW() ELSE finished_at END,
           meta = COALESCE($2::jsonb, meta)
         WHERE job_id = $3::uuid`,
        [b.status, b.meta ? JSON.stringify(b.meta) : null, jobId]
      );
    } else {
      const ins = await pool.query<{ job_id: string }>(
        `INSERT INTO rb_product_jobs (build_id, standalone, team, status, last_event_at, meta)
         VALUES ($1::uuid, $2, $3, $4, NOW(), $5::jsonb) RETURNING job_id`,
        [buildId, b.standalone, b.team, b.status, JSON.stringify(b.meta ?? {})]
      );
      jobId = ins.rows[0].job_id;
    }
    await logEvent(pool, buildId, b.team, "job_event", { standalone: b.standalone, status: b.status });
    return reply.code(200).send({ ok: true, job_id: jobId });
  });

  app.post("/report/:buildId/lifecycle", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { buildId } = req.params as { buildId: string };
    if (!(await ensureProduct(pool, buildId))) return reply.code(404).send({ ok: false, error: "build_not_found" });
    const b = req.body as { status?: string };
    if (!b.status) return reply.code(400).send({ ok: false, error: "status required" });
    await pool.query(
      `UPDATE rb_products SET status = $1, updated_at = NOW(), retired_at = CASE WHEN $1 = 'retired' THEN NOW() ELSE retired_at END WHERE build_id = $2::uuid`,
      [b.status, buildId]
    );
    await logEvent(pool, buildId, "router", "lifecycle", { status: b.status });
    return reply.send({ ok: true });
  });
}
