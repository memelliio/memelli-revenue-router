# memelli-revenue-router

Surface 4 control-surface microservice for the Memelli revenue stack.

- Receives Build Specs per `.agent-sync/BUILD_SPEC_SCHEMA.md`
- Validates Gates B / media-provider rules
- Persists product registry (`rb_*` tables)
- Receives `/report/*` callbacks from per-team standalones (design / seo / etc.)
- Surfaces read APIs at `/product/:buildId` etc.

Provisioning script: `memelli.io/.scratch/setup-revenue-router.mjs`.
Domain: https://revenue.memelli.io
