// POST /spec/submit — accepts a full Build Spec, validates, persists, dispatches.
// Returns { build_id, accepted_at, sections } on 201 or { ok:false, reasons } on 400.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireAuth } from "../lib/auth.js";
import { validateBuildSpec, summarizeSections } from "../lib/validator.js";

function safeUuid(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return re.test(v) ? v : null;
}

export function registerSpecRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/spec/submit", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const spec = req.body as Record<string, unknown>;
    const { ok, reasons } = validateBuildSpec(spec);
    if (!ok) {
      return reply.code(400).send({ ok: false, error: "spec_rejected", reasons });
    }
    const tenantId = safeUuid(spec.tenant_id) ?? null;
    if (!tenantId) {
      return reply
        .code(400)
        .send({ ok: false, error: "spec_rejected", reasons: [{ rule: "tenant_id_uuid", detail: "tenant_id must be a UUID" }] });
    }
    const operatorId = safeUuid(spec.operator_id);
    const intent = String(spec.intent ?? "");
    const niche = (spec.niche as Record<string, unknown> | undefined) ?? {};
    const nicheSlug = typeof niche.slug === "string" ? niche.slug : null;
    const nicheId =
      typeof niche.id === "number" ? niche.id : typeof niche.id === "string" ? parseInt(niche.id, 10) : null;
    const buildIdRaw = typeof spec.build_id === "string" ? spec.build_id : null;
    const buildId = safeUuid(buildIdRaw);

    const acceptedAt = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const insertedSpec = await client.query<{ build_id: string }>(
        `INSERT INTO rb_build_specs (build_id, tenant_id, operator_id, intent, niche_id, niche_slug, spec, validated_at)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, NOW())
         RETURNING build_id`,
        [buildId, tenantId, operatorId, intent, nicheId, nicheSlug, JSON.stringify(spec)]
      );
      const build_id = insertedSpec.rows[0].build_id;
      const store = (spec.store as Record<string, unknown> | undefined) ?? {};
      const domain = typeof store.domain === "string" ? store.domain : null;
      await client.query(
        `INSERT INTO rb_products (build_id, tenant_id, niche_slug, domain, status)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'provisioning')
         ON CONFLICT (build_id) DO UPDATE SET niche_slug = EXCLUDED.niche_slug, domain = EXCLUDED.domain, updated_at = NOW()`,
        [build_id, tenantId, nicheSlug, domain]
      );
      await client.query(
        `INSERT INTO rb_product_events (build_id, team, event_type, payload)
         VALUES ($1::uuid, 'router', 'spec_accepted', $2::jsonb)`,
        [build_id, JSON.stringify({ intent, niche_slug: nicheSlug, sections: summarizeSections(spec) })]
      );
      await client.query("COMMIT");
      return reply.code(201).send({
        ok: true,
        build_id,
        accepted_at: acceptedAt,
        sections: summarizeSections(spec),
      });
    } catch (err) {
      await client.query("ROLLBACK");
      req.log.error({ err }, "spec/submit failed");
      return reply.code(500).send({ ok: false, error: "internal", detail: (err as Error).message });
    } finally {
      client.release();
    }
  });
}
