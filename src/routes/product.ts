// Read APIs — all auth-gated (operator JWT or INTERNAL_SERVICE_TOKEN).

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireAuth } from "../lib/auth.js";

export function registerProductRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/product/:buildId", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { buildId } = req.params as { buildId: string };
    const product = await pool.query(
      `SELECT p.*, s.intent, s.spec FROM rb_products p
       LEFT JOIN rb_build_specs s ON s.build_id = p.build_id
       WHERE p.build_id = $1::uuid`,
      [buildId]
    );
    if (!product.rows[0]) return reply.code(404).send({ ok: false, error: "not_found" });
    const [assets, logins, marketing, jobs] = await Promise.all([
      pool.query(`SELECT * FROM rb_product_assets WHERE build_id = $1::uuid ORDER BY created_at DESC`, [buildId]),
      pool.query(`SELECT * FROM rb_product_logins WHERE build_id = $1::uuid ORDER BY created_at DESC`, [buildId]),
      pool.query(`SELECT * FROM rb_product_marketing WHERE build_id = $1::uuid ORDER BY last_event_at DESC NULLS LAST`, [buildId]),
      pool.query(`SELECT * FROM rb_product_jobs WHERE build_id = $1::uuid ORDER BY started_at DESC`, [buildId]),
    ]);
    return reply.send({
      ok: true,
      product: product.rows[0],
      assets: assets.rows,
      logins: logins.rows,
      marketing: marketing.rows,
      jobs: jobs.rows,
    });
  });

  app.get("/tenant/:tenantId/products", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { tenantId } = req.params as { tenantId: string };
    const r = await pool.query(
      `SELECT * FROM rb_products WHERE tenant_id = $1::uuid ORDER BY created_at DESC LIMIT 500`,
      [tenantId]
    );
    return reply.send({ ok: true, count: r.rows.length, products: r.rows });
  });

  app.get("/product/:buildId/jobs", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { buildId } = req.params as { buildId: string };
    const r = await pool.query(
      `SELECT * FROM rb_product_jobs WHERE build_id = $1::uuid ORDER BY started_at DESC`,
      [buildId]
    );
    return reply.send({ ok: true, jobs: r.rows });
  });

  app.get("/product/:buildId/events", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { buildId } = req.params as { buildId: string };
    const r = await pool.query(
      `SELECT * FROM rb_product_events WHERE build_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [buildId]
    );
    return reply.send({ ok: true, events: r.rows });
  });
}
