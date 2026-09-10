function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function hitMatches(hit, expected) {
  if (expected.sourceTypes?.length && !expected.sourceTypes.includes(hit.sourceType)) return false;
  const text = normalize(`${hit.title || ''} ${hit.content || ''}`);
  return (expected.anyText || []).some((term) => text.includes(normalize(term)));
}

function evaluateCase(testCase, hits, latencyMs) {
  const expected = testCase.expected || {};
  const matched = hits.some((hit) => hitMatches(hit, expected));
  const linkedHits = hits.filter((hit) => /^https:\/\/thetrickbook\.com\//.test(hit.webUrl || ''));
  const sourceTypeMatched =
    !expected.sourceTypes?.length ||
    hits.some((hit) => expected.sourceTypes.includes(hit.sourceType));
  return {
    id: testCase.id,
    query: testCase.query,
    passed: matched && sourceTypeMatched,
    matched,
    sourceTypeMatched,
    linkCoverage: hits.length ? linkedHits.length / hits.length : 0,
    latencyMs,
    hits: hits.map((hit) => ({
      sourceType: hit.sourceType,
      sourceId: hit.sourceId,
      title: hit.title,
      webUrl: hit.webUrl,
      score: hit.score,
    })),
  };
}

function summarize(results) {
  const count = results.length;
  const passed = results.filter((result) => result.passed).length;
  const average = (field) =>
    count ? results.reduce((sum, result) => sum + Number(result[field] || 0), 0) / count : 0;
  return {
    cases: count,
    passed,
    recallAt5: count ? passed / count : 0,
    averageLinkCoverage: average('linkCoverage'),
    averageLatencyMs: average('latencyMs'),
    p95LatencyMs: count
      ? [...results].sort((a, b) => a.latencyMs - b.latencyMs)[Math.ceil(count * 0.95) - 1]
          .latencyMs
      : 0,
  };
}

module.exports = { evaluateCase, hitMatches, summarize };
