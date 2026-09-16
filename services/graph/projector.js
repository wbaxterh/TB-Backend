const { ObjectId } = require('mongodb');

const visibleEdge = (edge) => ['reviewed', 'published'].includes(edge?.research?.status);

async function projectTrick(db, graph, sourceId) {
  if (!ObjectId.isValid(sourceId)) return;
  const trick = await db.collection('trickipedia').findOne({ _id: new ObjectId(sourceId) });
  if (!trick) {
    await graph.run('MATCH (t:Trick {sourceId: $sourceId}) DETACH DELETE t', { sourceId });
    return;
  }
  await graph.run(
    `MERGE (t:Trick {sourceId: $sourceId})
     SET t.name = $name, t.slug = $slug, t.sport = $sport, t.difficulty = $difficulty, t.updatedAt = $updatedAt`,
    {
      sourceId,
      name: trick.name || '',
      slug: trick.url || '',
      sport: trick.sportTypes?.[0] || trick.category || '',
      difficulty: trick.difficulty || '',
      updatedAt: new Date(trick.updatedAt || trick.createdAt || Date.now()).toISOString(),
    },
  );
  await graph.run(
    'MATCH (t:Trick {sourceId: $sourceId})-[r:PREREQUISITE_OF|NEXT_STEP]->() DELETE r',
    {
      sourceId,
    },
  );
  for (const edge of (trick.progression?.nextSteps || []).filter(visibleEdge)) {
    await graph.run(
      `MATCH (from:Trick {sourceId: $sourceId})
       MERGE (to:Trick {sourceId: $targetId})
       MERGE (from)-[r:NEXT_STEP]->(to)
       SET r.reason = $reason, r.order = $order`,
      {
        sourceId,
        targetId: String(edge.trickId),
        reason: edge.reason || '',
        order: edge.order ?? 999,
      },
    );
  }
  for (const edge of (trick.progression?.prerequisites || []).filter(visibleEdge)) {
    await graph.run(
      `MATCH (to:Trick {sourceId: $sourceId})
       MERGE (from:Trick {sourceId: $targetId})
       MERGE (from)-[r:PREREQUISITE_OF]->(to)
       SET r.reason = $reason, r.strength = $strength, r.order = $order`,
      {
        sourceId,
        targetId: String(edge.trickId),
        reason: edge.reason || '',
        strength: edge.strength || 'helpful',
        order: edge.order ?? 999,
      },
    );
  }
}

async function projectLandedTrick(graph, payload) {
  const { riderId, trickId, trickName, landed } = payload;
  if (!riderId || !trickId) return;
  await graph.run(
    `MERGE (r:Rider {sourceId: $riderId})
     MERGE (t:Trick {sourceId: $trickId})
     SET t.name = CASE WHEN $trickName = '' THEN t.name ELSE $trickName END
     FOREACH (_ IN CASE WHEN $landed THEN [1] ELSE [] END |
       MERGE (r)-[rel:LANDED]->(t) SET rel.updatedAt = $updatedAt)
     FOREACH (_ IN CASE WHEN $landed THEN [] ELSE [1] END |
       MERGE (r)-[rel:LANDED]->(t) DELETE rel)`,
    {
      riderId,
      trickId,
      trickName: trickName || '',
      landed: Boolean(landed),
      updatedAt: new Date().toISOString(),
    },
  );
}

async function projectEvent(db, graph, event) {
  if (event.type === 'trick.upserted' || event.type === 'trick.deleted') {
    return projectTrick(db, graph, event.aggregateId);
  }
  if (event.type === 'rider.trick-status-changed') return projectLandedTrick(graph, event.payload);
  throw new Error(`Unsupported graph event type: ${event.type}`);
}

module.exports = { projectEvent, projectLandedTrick, projectTrick, visibleEdge };
