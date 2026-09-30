const assert = require('node:assert/strict');
const test = require('node:test');
const { applyCollectionSchemas, describeSummary } = require('../schemas/apply');

const registry = {
  users: { jsonSchema: { bsonType: 'object', properties: { email: { bsonType: 'string' } } } },
  tricks: { jsonSchema: { bsonType: 'object', properties: {} } },
};

function createDb({ existing, failOn = [] }) {
  const commands = [];
  return {
    commands,
    listCollections: () => ({ toArray: async () => existing.map((name) => ({ name })) }),
    async command(command) {
      commands.push(command);
      if (failOn.includes(command.collMod)) throw new Error(`boom ${command.collMod}`);
      return { ok: 1 };
    },
  };
}

test('applies validators only to collections that exist and never creates one', async () => {
  const db = createDb({ existing: ['users', 'legacy_thing'] });
  const summary = await applyCollectionSchemas(db, { registry });
  assert.deepEqual(summary.applied, ['users']);
  assert.deepEqual(summary.missing, ['tricks']);
  assert.deepEqual(summary.unregistered, ['legacy_thing']);
  assert.deepEqual(summary.failed, []);
  assert.deepEqual(db.commands, [
    {
      collMod: 'users',
      validator: { $jsonSchema: registry.users.jsonSchema },
      validationLevel: 'moderate',
      validationAction: 'warn',
    },
  ]);
});

test('off still reports drift but sends no commands', async () => {
  const db = createDb({ existing: ['users', 'orphan'] });
  const summary = await applyCollectionSchemas(db, { registry, action: 'off' });
  assert.deepEqual(db.commands, []);
  assert.deepEqual(summary.unregistered, ['orphan']);
});

test('a failing collMod is collected, not thrown', async () => {
  const db = createDb({ existing: ['users', 'tricks'], failOn: ['tricks'] });
  const summary = await applyCollectionSchemas(db, { registry, action: 'error', level: 'strict' });
  assert.deepEqual(summary.applied, ['users']);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0].name, 'tricks');
  assert.match(describeSummary(summary), /error\/strict; applied 1; failed 1 \(tricks\)/);
});

test('rejects unknown actions and levels before touching the database', async () => {
  const db = createDb({ existing: [] });
  await assert.rejects(
    applyCollectionSchemas(db, { registry, action: 'maybe' }),
    /warn, error or off/,
  );
  await assert.rejects(
    applyCollectionSchemas(db, { registry, level: 'loose' }),
    /moderate or strict/,
  );
  assert.deepEqual(db.commands, []);
});
