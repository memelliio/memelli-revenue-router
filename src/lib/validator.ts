// Build Spec validator — enforces BUILD_SPEC_SCHEMA.md "Validator rules (binding)".
// Rejected reasons returned as { rule, detail } pairs.

const BANNED_AD_KEYS = ["meta_ads", "google_ads", "tiktok_ads", "bing_ads", "paid_traffic"];
const BANNED_MEDIA_PROVIDERS = ["wavespeed", "fal", "elevenlabs", "sync-so", "remotion"];
const APPROVED_DASHSCOPE_PROVIDERS = [
  "dashscope-cosyvoice",
  "dashscope-sambert",
  "dashscope-wanx",
  "dashscope-wanx-i2v",
  "dashscope-qwen-vl-plus",
  "dashscope-paraformer",
];

export type Reason = { rule: string; detail: string };

function walk(node: unknown, fn: (key: string, value: unknown, path: string) => void, path = ""): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walk(node[i], fn, `${path}[${i}]`);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    fn(k, v, path ? `${path}.${k}` : k);
    walk(v, fn, path ? `${path}.${k}` : k);
  }
}

export function validateBuildSpec(spec: unknown): { ok: boolean; reasons: Reason[] } {
  const reasons: Reason[] = [];
  if (!spec || typeof spec !== "object") {
    return { ok: false, reasons: [{ rule: "shape", detail: "spec must be an object" }] };
  }
  const s = spec as Record<string, unknown>;

  if (!s.tenant_id || typeof s.tenant_id !== "string") {
    reasons.push({ rule: "tenant_id_required", detail: "tenant_id missing or not a string" });
  }

  const gc = s.growth_constraints as Record<string, unknown> | undefined;
  if (!gc || typeof gc !== "object") {
    reasons.push({ rule: "gate_b_ad_spend", detail: "growth_constraints missing — ad_spend_usd_per_month must be 0" });
  } else if (gc.ad_spend_usd_per_month !== 0) {
    reasons.push({
      rule: "gate_b_ad_spend",
      detail: `growth_constraints.ad_spend_usd_per_month must be 0; got ${JSON.stringify(gc.ad_spend_usd_per_month)}`,
    });
  }

  walk(s, (key, _value, path) => {
    if (BANNED_AD_KEYS.includes(key)) {
      reasons.push({ rule: "gate_b_banned_key", detail: `banned ad key '${key}' at path '${path}'` });
    }
  });

  const ugc = s.ugc_factory as Record<string, unknown> | undefined;
  if (ugc && typeof ugc === "object") {
    const slots: Array<["voice" | "visual" | "captions", Record<string, unknown> | undefined]> = [
      ["voice", ugc.voice as Record<string, unknown> | undefined],
      ["visual", ugc.visual as Record<string, unknown> | undefined],
      ["captions", ugc.captions as Record<string, unknown> | undefined],
    ];
    for (const [slot, obj] of slots) {
      if (!obj) continue;
      const provider = obj.provider;
      if (typeof provider !== "string") continue;
      if (BANNED_MEDIA_PROVIDERS.includes(provider)) {
        reasons.push({
          rule: "gate_media_provider_banned",
          detail: `ugc_factory.${slot}.provider '${provider}' is banned — use dashscope-* providers`,
        });
      } else if (!APPROVED_DASHSCOPE_PROVIDERS.includes(provider) && !provider.startsWith("dashscope-")) {
        reasons.push({
          rule: "gate_media_provider_unknown",
          detail: `ugc_factory.${slot}.provider '${provider}' is not an approved dashscope-* provider — flag for review`,
        });
      }
    }
  }

  // Block any direct media-gen provider keys outside ugc_factory
  walk(s, (key, value, path) => {
    if (path.startsWith("ugc_factory")) return;
    if (key === "provider" && typeof value === "string" && BANNED_MEDIA_PROVIDERS.includes(value)) {
      reasons.push({
        rule: "gate_media_provider_outside_ugc",
        detail: `'${value}' provider referenced at '${path}' — all media must route through ugc_factory`,
      });
    }
  });

  if (typeof s.version !== "string" || !s.version) {
    reasons.push({ rule: "version_missing", detail: "version field missing" });
  }
  if (typeof s.intent !== "string" || !s.intent) {
    reasons.push({ rule: "intent_missing", detail: "intent field missing" });
  }

  return { ok: reasons.length === 0, reasons };
}

export function summarizeSections(spec: Record<string, unknown>): string[] {
  const known = [
    "brand", "seo_plan", "social_plan", "lead_plan", "products",
    "distribution", "fulfillment", "ugc_factory", "crm", "store",
    "analytics", "email_plan",
  ];
  return known.filter((k) => k in spec);
}
