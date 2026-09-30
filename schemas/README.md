# Collection schemas

The backend talks to MongoDB through the raw driver, so until now a collection's shape was
whatever each `insertOne` happened to write. This directory is the declared shape.

- `collections/*.js`: one `$jsonSchema` per collection, grouped by domain, derived from the
  write sites listed under `writers`. `notes` records where writers disagree (mixed id types,
  spread-body updates) so the schema stays honest instead of aspirational.
- `index.js`: the registry (`names`, `registry`, `getSchema`, `validate`).
- `validate.js`: an app-side evaluator for the `$jsonSchema` subset in use, so schemas are
  testable without a database and live documents can be checked from a script.
- `apply.js`: pushes every schema to the database as a collection validator (`collMod`).
  Runs on every boot from `index.js`; never creates collections; failures are logged.

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `SCHEMA_VALIDATION_ACTION` | `warn` | `warn` logs violations server-side, `error` rejects them, `off` skips apply |
| `SCHEMA_VALIDATION_LEVEL` | `moderate` | `moderate` checks inserts and updates to already-valid docs; `strict` checks every write |

## Scripts

- `npm run schema:report`: samples the newest documents in each collection and validates them
  app-side. This is the feedback loop on Atlas M0, where the server's warn log is not readable.
- `npm run schema:apply -- --action error`: promote validators once the report is clean.

## Promotion path

1. Keep `warn` until `schema:report` shows zero invalid documents for a collection.
2. Fix writers, or widen the schema when production data is legitimately older than the code.
3. Switch that collection to `error` by editing its entry (or globally via the env var).

## The three user id shapes

`req.user.userId` comes out of the JWT as a 24-hex string. Some writers store it as that string,
some convert with `new ObjectId(...)`, and rows from the original app hold a DBRef. Schemas list
every shape that exists; `utils/ids.js` (`toObjectId`, `idEquals`, `anyIdShape`) is the way to
read or query across them. New code stores ObjectId.

## Adding a collection

1. Add an entry to the domain file (or a new file) following the existing contract.
2. `npm test`: `schema-registry.test.js` fails if any `collection('name')` call has no schema.
3. It is applied on the next boot.
