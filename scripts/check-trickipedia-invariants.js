#!/usr/bin/env node
/**
 * Trickipedia conformance check: verifies the static invariants of the
 * formal spec (docs: features/trickipedia-formal-spec) against live data.
 *   - no self-edges              - referential integrity (no dangling ids)
 *   - category consistency       - valid research statuses
 *   - prerequisite acyclicity (the learnability property)
 * Exit code 1 if any invariant is violated. MONGODB_DATABASE selects target.
 */
require('dotenv').config();
const { connectToDatabase, closeDatabase } = require('../db');

const GROUPS = ['prerequisites', 'nextSteps', 'related'];
const VALID_STATUSES = ['draft', 'reviewed', 'published', 'rejected'];

(async () => {
  const db = await connectToDatabase();
  const tricks = await db
    .collection('trickipedia')
    .find({})
    .project({ name: 1, url: 1, category: 1, progression: 1 })
    .toArray();
  const byId = new Map(tricks.map((t) => [t._id.toString(), t]));
  const report = {
    tricks: tricks.length,
    edges: 0,
    selfEdges: [],
    dangling: [],
    crossCategory: [],
    badStatus: [],
    cycles: [],
  };
  const prereqAdj = new Map();

  for (const t of tricks) {
    for (const g of GROUPS) {
      for (const e of t.progression?.[g] || []) {
        report.edges++;
        const target = e.trickId?.toString();
        const status = e.research?.status;
        if (!VALID_STATUSES.includes(status)) report.badStatus.push(`${t.url}:${g}`);
        if (target === t._id.toString()) report.selfEdges.push(t.url);
        const tt = byId.get(target);
        if (!tt) report.dangling.push(`${t.url} -> ${g}:${target}`);
        else if (tt.category !== t.category) report.crossCategory.push(`${t.url} -> ${tt.url}`);
        if (g === 'prerequisites' && tt && ['reviewed', 'published'].includes(status)) {
          if (!prereqAdj.has(t._id.toString())) prereqAdj.set(t._id.toString(), []);
          prereqAdj.get(t._id.toString()).push(target);
        }
      }
    }
  }

  const color = new Map();
  const dfs = (u, path) => {
    color.set(u, 1);
    for (const v of prereqAdj.get(u) || []) {
      if (color.get(v) === 1) {
        report.cycles.push([...path, byId.get(v)?.url].join(' -> '));
        continue;
      }
      if (!color.get(v)) dfs(v, [...path, byId.get(v)?.url]);
    }
    color.set(u, 2);
  };
  for (const id of prereqAdj.keys()) if (!color.get(id)) dfs(id, [byId.get(id)?.url]);

  const violations =
    report.selfEdges.length +
    report.dangling.length +
    report.crossCategory.length +
    report.badStatus.length +
    report.cycles.length;
  console.log(JSON.stringify({ database: db.databaseName, ...report, violations }, null, 1));
  await closeDatabase();
  if (violations > 0) process.exitCode = 1;
})();
