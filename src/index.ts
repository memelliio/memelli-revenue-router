// memelli-revenue-router — Surface 4 control-surface microservice.
// Owns: rb_build_specs, rb_products, rb_product_assets, rb_product_logins,
//       rb_product_marketing, rb_product_jobs, rb_product_events.
// Receives Build Specs (per .agent-sync/BUILD_SPEC_SCHEMA.md), validates, dispatches
// WorkOrders to standalones (design / seo / etc.), receives /report/* callbacks,
// surfaces read APIs.

import Fastify from "fastify";
import cors from "@fastify/cors";
import pg from "pg";
import { registerSpecRoutes } from "./routes/spec.js";
import { registerProductRoutes } from "./routes/product.js";
import { registerReportRoutes } from "./routes/report.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL env var required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
const bootAt = new Date().toISOString();
const SHA = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || "unknown";

async function main() {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(cors, { origin: true, credentials: true });

  app.get("/health", async () => ({
    ok: true,
    started_at: bootAt,
    uptime: Math.round(process.uptime()),
    sha: SHA,
    repo: "memelliio/memelli-revenue-router",
    module: "revenue-router",
    env: process.env.NODE_ENV || "development",
  }));

  await app.register(async (sub) => {
    registerSpecRoutes(sub, pool);
    registerProductRoutes(sub, pool);
    registerReportRoutes(sub, pool);
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`memelli-revenue-router listening on :${PORT}`);
}

main().catch((err) => {
  console.error("boot failed:", err);
  process.exit(1);
});
