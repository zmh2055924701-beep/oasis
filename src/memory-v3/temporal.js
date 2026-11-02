// MP-4 temporal validity helpers. Facts keep raw history; validTo is derived.
export function normalizeValidity(fact = {}, now = Date.now()) {
  return {
    validFrom: Number(fact.validFrom || now) || now,
    validTo: Number(fact.validTo || 0) || 0,
  };
}

export function isFactValidAt(fact = {}, at = Date.now()) {
  const v = normalizeValidity(fact);
  return at >= v.validFrom && (!v.validTo || at < v.validTo);
}

export function markSuperseded(oldFact = {}, newFact = {}, now = Date.now()) {
  return { ...oldFact, validTo: now, supersededBy: String(newFact.id || '') };
}

export function selectCurrentFacts(facts = [], { at = Date.now(), subject = '', predicate = '' } = {}) {
  return (Array.isArray(facts) ? facts : []).filter((f) => {
    if (subject && f.subject !== subject) return false;
    if (predicate && f.predicate !== predicate) return false;
    return isFactValidAt(f, at);
  });
}
