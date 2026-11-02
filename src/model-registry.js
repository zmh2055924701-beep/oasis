// Model registry: the user-facing target name is v4.1Flash 1017.
// DSH currently exposes the same model family as the id deepseek-flash.
// Never silently claim a model exists; resolve against the live catalog.
export const REQUESTED_MODEL = 'v4.1flash1017';
export const TARGET_ALIASES = Object.freeze({
  'v4.1flash1017': 'deepseek-flash',
  'v4.1flash-1017': 'deepseek-flash',
  'deepseek-v4.1-flash-1017': 'deepseek-flash',
  'deepseek-v4.1-flash': 'deepseek-flash',
  'v4.1-flash': 'deepseek-flash',
});
export const FALLBACK_MODEL = 'deepseek-flash';

export function flattenCatalog(catalog) {
  const groups = catalog?.result?.value?.groups || catalog?.value?.groups || catalog?.groups || [];
  const ids = [];
  for (const g of groups) for (const m of (g.models || [])) if (m.id) ids.push(String(m.id));
  return [...new Set(ids)];
}
export function resolveRequestedModel(requested = REQUESTED_MODEL, catalog = null) {
  const catalogIds = catalog ? flattenCatalog(catalog) : [];
  const direct = TARGET_ALIASES[String(requested)] || String(requested);
  if (!catalogIds.length || catalogIds.includes(direct)) return { ok: true, requested, resolved: direct, aliased: direct !== requested, catalogIds };
  if (catalogIds.includes(FALLBACK_MODEL)) return { ok: true, requested, resolved: FALLBACK_MODEL, aliased: true, fallback: true, reason: 'target-id-not-in-catalog', catalogIds };
  return { ok: false, requested, resolved: '', reason: 'no-compatible-model', catalogIds };
}
