const { registry } = require('./index');

const ACTIONS = new Set(['warn', 'error', 'off']);
const LEVELS = new Set(['moderate', 'strict']);

// Push every registered $jsonSchema to the live database as a collection validator.
// Existing collections only: this never creates one. Per-collection failures are
// collected rather than thrown because a validator is not worth a failed boot.
async function applyCollectionSchemas(db, options = {}) {
  const action = options.action || process.env.SCHEMA_VALIDATION_ACTION || 'warn';
  const level = options.level || process.env.SCHEMA_VALIDATION_LEVEL || 'moderate';
  const schemas = options.registry || registry;
  if (!ACTIONS.has(action)) {
    throw new Error(`SCHEMA_VALIDATION_ACTION must be warn, error or off (got "${action}")`);
  }
  if (!LEVELS.has(level)) {
    throw new Error(`SCHEMA_VALIDATION_LEVEL must be moderate or strict (got "${level}")`);
  }

  const summary = { action, level, applied: [], missing: [], failed: [], unregistered: [] };
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
  );
  summary.unregistered = [...existing]
    .filter((name) => !schemas[name] && !name.startsWith('system.'))
    .sort();
  if (action === 'off') return summary;

  for (const name of Object.keys(schemas).sort()) {
    if (!existing.has(name)) {
      summary.missing.push(name);
      continue;
    }
    try {
      await db.command({
        collMod: name,
        validator: { $jsonSchema: schemas[name].jsonSchema },
        validationLevel: level,
        validationAction: action,
      });
      summary.applied.push(name);
    } catch (error) {
      summary.failed.push({ name, error: error.message });
    }
  }
  return summary;
}

function describeSummary(summary) {
  const parts = [
    `validators ${summary.action}/${summary.level}`,
    `applied ${summary.applied.length}`,
  ];
  if (summary.missing.length) parts.push(`not present ${summary.missing.length}`);
  if (summary.failed.length) {
    parts.push(`failed ${summary.failed.length} (${summary.failed.map((f) => f.name).join(', ')})`);
  }
  if (summary.unregistered.length) {
    parts.push(`unregistered collections: ${summary.unregistered.join(', ')}`);
  }
  return parts.join('; ');
}

module.exports = { applyCollectionSchemas, describeSummary };
