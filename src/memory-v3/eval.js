// MP-8 evaluation helpers: retrieval recall / token curve.
export function scoreRetrieval({ expected = [], actual = [] } = {}) {
  const exp = new Set((Array.isArray(expected) ? expected : []).map(String));
  const got = (Array.isArray(actual) ? actual : []).map(String);
  if (!exp.size) return { recall: null, precision: null, mrr: null, hits: 0 };
  let hits = 0;
  let mrr = 0;
  for (let i = 0; i < got.length; i += 1) {
    if (exp.has(got[i])) {
      hits += 1;
      if (!mrr) mrr = 1 / (i + 1);
    }
  }
  return {
    recall: Number((hits / exp.size).toFixed(3)),
    precision: got.length ? Number((hits / got.length).toFixed(3)) : null,
    mrr: Number(mrr.toFixed(3)),
    hits,
  };
}

export function tokenCurve(samples = []) {
  const list = (Array.isArray(samples) ? samples : []).map((x) => Number(x.tokens || x.totalTokens || 0)).filter((n) => n > 0);
  if (!list.length) return { samples: 0, first: 0, last: 0, peak: 0, growth: 0 };
  return {
    samples: list.length,
    first: list[0],
    last: list[list.length - 1],
    peak: Math.max(...list),
    growth: list[0] ? Number(((list[list.length - 1] / list[0] - 1) * 100).toFixed(1)) : null,
  };
}

export function summarizeEval({ retrieval = [], tokens = [] } = {}) {
  const rs = retrieval.map((r) => scoreRetrieval(r));
  const valid = rs.filter((r) => r.recall !== null);
  return {
    retrievalCases: valid.length,
    avgRecall: valid.length ? Number((valid.reduce((s, r) => s + r.recall, 0) / valid.length).toFixed(3)) : null,
    avgMrr: valid.length ? Number((valid.reduce((s, r) => s + r.mrr, 0) / valid.length).toFixed(3)) : null,
    tokenCurve: tokenCurve(tokens),
  };
}
