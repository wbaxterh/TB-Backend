# Progression graph runbook

MongoDB remains authoritative. Neo4j is a rebuildable recommendation projection; API requests fall back to MongoDB whenever the graph is disabled, empty, slow, or unavailable.

## Staging rollout

1. Provision a staging-only Neo4j database and restrict ports 7474/7687 to the backend host/private network.
2. Set `NEO4J_ENABLED=true`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE` on the staging backend.
3. Run `npm run graph:rebuild` once. It creates uniqueness constraints and rebuilds `Rider`, `Trick`, `LANDED`, `NEXT_STEP`, and `PREREQUISITE_OF` data from MongoDB.
4. Restart the backend. The graph outbox projector then handles incremental trick and landed-status changes.
5. Call authenticated `GET /api/recommendations/progression?sport=skateboarding&limit=5`. Confirm `source` is `neo4j`; then disable Neo4j temporarily and confirm `mongo-fallback` returns successfully.
6. Call admin-only `GET /api/recommendations/graph-health` and confirm the graph is reachable with no dead events.

## Operations

- `graph_outbox` events are idempotent and retry with exponential backoff. Ten failed attempts move an event to `dead` for inspection.
- Monitor pending/dead event counts and oldest pending-event age. Alert if pending age exceeds five minutes or any dead event exists.
- The HTTP client times out after three seconds by default. A graph failure must never fail core MongoDB trick tracking.
- Rerun `npm run graph:rebuild` after schema changes or suspected projection drift. Use `--no-clear` only for additive repair.
- Back up Neo4j before destructive maintenance, but MongoDB plus the rebuild command is the recovery source.

## Initial success metric

Compare seven-day trick-list return rate and new trick attempts for riders shown graph recommendations versus the Mongo fallback/control experience.
