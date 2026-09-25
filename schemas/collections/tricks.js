// schemas/collections/tricks.js
// Derived from the write sites listed under `writers`; see schemas/README.md.

const id = { bsonType: 'objectId' };
const str = { bsonType: 'string' };
const strOrNull = { bsonType: ['string', 'null'] };
const date = { bsonType: 'date' };
const counter = { bsonType: 'int' };
const strArray = { bsonType: 'array', items: str };

// One progression edge as routes/trickipedia.js normalizeProgression and the two
// migrate-*-network scripts write it. strength exists on prerequisites only,
// relation on related only; research stays an open object at this depth.
const progressionEdge = {
  bsonType: 'object',
  properties: {
    trickId: id,
    reason: str,
    strength: { enum: ['required', 'recommended', 'helpful'] },
    relation: {
      enum: ['variation', 'opposite-direction', 'same-family', 'combination', 'terrain-transfer'],
    },
    order: { bsonType: 'number' },
    research: { bsonType: 'object' },
  },
};

module.exports = {
  tricks: {
    description:
      'One rider-owned checklist row (a personal trick) that belongs to a tricklist via list_id.',
    writers: ['routes/listing.js', 'kaori-tools.js', 'routes/feed.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['createdAt'],
      properties: {
        _id: id,
        name: str,
        link: str,
        notes: str,
        list_id: str,
        checked: { bsonType: ['string', 'bool'] },
        trickipediaId: str,
        spotId: strOrNull,
        videoUrl: strOrNull,
        feedPostId: strOrNull,
        createdBy: { enum: ['kaori'] },
        createdAt: date,
        updatedAt: date,
        url: str,
        category: str,
      },
    },
    notes: [
      'Insert sites: routes/listing.js PUT / spreads req.body and adds createdAt, so the stored shape is whatever the client sent (TrickList/src/lib/api/trickbook.ts and TrickBookWebsite/lib/apiTrickLists.js send list_id, name, link, notes, checked "To Do" and an optional trickipediaId); kaori-tools.js addTrickToList writes name, list_id, checked "To Do", createdAt, createdBy "kaori". Only createdAt is present at both, hence the one-field required set. list_id is enforced for non-admins by the ownership check (userOwnsTrickList needs a valid ObjectId string) but not for admins.',
      'list_id: the parent tricklist _id as a 24-hex string, never an ObjectId. routes/listing.js GET / matches it as a string and routes/listings.js DELETE /:id runs deleteMany({ list_id: id }) with the string. The reverse link, tricklists.tricks[]._id, is an ObjectId and is what ownership checks (userOwnsTrick) actually walk.',
      'checked: free string, no validation on write. Values written today: "To Do" (both inserts and mobile reset), "Completed" and "Learning" (mobile PUT /listing/update maps Landed/Mastered to "Completed"), "Complete" (kaori-tools update_trick_status enum), plus anything a client posts to PUT /update. Readers disagree: services/graph/recommendations.js and scripts/rebuild-progression-graph.js select checked "Landed", routes/listing.js PUT /update enqueues landed only when the lowercased value is "landed", workers/reminderSender.js treats "Complete"/"Completed" as done, kaori-tools.js treats "Complete" or boolean true as done. No current writer produces "Landed" or true, so the graph LANDED projection never fires from the app; bool is kept for the legacy rows kaori-tools still checks for.',
      'spotId, videoUrl, feedPostId: strings or null. routes/listing.js PUT /edit, PUT /:trickId/spot and PUT /:trickId/video write value || null; routes/feed.js POST /:postId/link-tricks writes feedPostId = postId (string). spotId is stored as a string and wrapped in new ObjectId() by populateSpotData, so a non-hex value would throw at read time.',
      'trickipediaId: sent by both clients and persisted only through the body spread; no backend code reads it. Target: objectId reference to trickipedia._id, currently a string.',
      'url and category: legacy read only. mcp/public-tools.js getTrick queries tricks by { url } and builds a link from category, but only trickipedia has those fields, so get_trick 404s on any slug. Probable wrong collection.',
      'updatedAt is written only by $set paths, never at insert; routes/listings.js sorts by updatedAt || createdAt for that reason.',
      'Readers: routes/listings.js GET / (joined into tricklists), routes/spotlists.js (trickIds lookups), routes/feed.js (trickIds names), kaori-tools.js, services/graph/recommendations.js, scripts/rebuild-progression-graph.js, routes/stats.js, routes/listing.js /allData and /graph (admin).',
    ],
  },

  tricklists: {
    description: 'A rider-owned, named list of personal tricks; the owner is a DBRef in user.',
    writers: ['routes/listings.js', 'routes/listing.js', 'kaori-tools.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['name', 'user', 'completed', 'tricks', 'isPublic', 'createdAt'],
      properties: {
        _id: id,
        name: str,
        user: {
          bsonType: 'object',
          description:
            'DBRef { $ref: "users", $id }; $id is the JWT userId string from current writers and an ObjectId on legacy rows',
        },
        completed: counter,
        tricks: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              _id: id,
              name: str,
              checked: str,
              status: str,
              link: str,
              notes: str,
              createdAt: date,
              updatedAt: date,
            },
          },
        },
        isPublic: { bsonType: 'bool' },
        createdBy: { enum: ['kaori'] },
        createdAt: date,
        updatedAt: date,
        lastViewedAt: date,
        userId: { bsonType: ['string', 'objectId'] },
      },
    },
    notes: [
      'Insert sites: routes/listings.js POST / (name from req.body.title, user, completed 0, tricks [], isPublic = req.body.isPublic !== false, createdAt) and kaori-tools.js createTricklist (same plus isPublic true and createdBy "kaori"). $set: routes/listings.js PUT /edit (name) and PUT /:id/visibility (isPublic). $push/$pull on tricks: routes/listing.js PUT / and DELETE /:id, kaori-tools.js addTrickToList.',
      'user: both writers call new DBRef("users", req.user.userId) with the JWT string, so mongodb 4.13 stores { $ref: "users", $id: "<24-hex>" }. Rows from the original app hold $id as an ObjectId. Every reader queries "user.$id"; routes/listings.js GET / and /countTrickLists and services/graph/recommendations.js also try the ObjectId form, while routes/listing.js /allTricks, routes/user.js /:id/stats, kaori-tools.js and routes/reminderCadence.js match the string only, so legacy ObjectId owners are invisible there. utils/dbRefId.js reads .oid (driver-hydrated DBRef) or .$id (plain object) and utils/ids.js toObjectId accepts both. The shape is described here rather than under properties because $-prefixed keys are not safe inside $jsonSchema properties. Target: $id objectId.',
      'tricks[]: current writers push { _id: ObjectId } only. name, checked, status, link, notes, createdAt and updatedAt inside the array are legacy embedded copies: routes/listings.js GET / falls back to them when the tricks row is missing, and workers/reminderSender.js pickReminderTrick reads checked || status and createdAt from the embedded entry only, so reminders sort by a date current writers never embed.',
      'completed: inserted as 0 and never updated; completion is derived at read time from tricks.checked.',
      'updatedAt and lastViewedAt: legacy read only. routes/analytics.js counts updatedAt as tricklist activity and services/reminderPlanner.js autoPauseStaleLists uses lastViewedAt || updatedAt as lastActive, but no writer sets either, so lastActive is null, the $lte cutoff match never succeeds, and auto-pause never fires.',
      'userId: legacy read only. routes/analytics.js activeUserCount runs distinct("userId") on this collection; the owner lives in user.$id, so that lane always contributes zero.',
      'isPublic: lists created before the flag have no key and are excluded by { isPublic: true } reads (GET /public, non-owner GET /). services/reminderPlanner.js reminderCadences.listId references _id as an ObjectId.',
    ],
  },

  trickipedia: {
    description:
      'Canonical catalog entry for one trick: tutorial text, media, and progression-graph edges, addressed by the url slug.',
    writers: [
      'routes/trickipedia.js',
      'scripts/migrate-trickipedia-network.js',
      'scripts/migrate-skateboarding-network.js',
    ],
    jsonSchema: {
      bsonType: 'object',
      required: [
        'name',
        'category',
        'difficulty',
        'description',
        'steps',
        'tips',
        'commonMistakes',
        'safety',
        'aliases',
        'images',
        'videoUrl',
        'videos',
        'tutorials',
        'progression',
        'source',
        'audit',
        'url',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: id,
        name: str,
        category: str,
        difficulty: str,
        description: str,
        steps: { bsonType: 'array' },
        tips: { bsonType: 'array' },
        commonMistakes: { bsonType: 'array' },
        safety: { bsonType: 'array' },
        aliases: strArray,
        images: strArray,
        videoUrl: strOrNull,
        videos: { bsonType: 'array' },
        tutorials: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              canonicalUrl: str,
              platform: str,
              availability: str,
              embedAllowed: { bsonType: 'bool' },
              featured: { bsonType: 'bool' },
              lastVerifiedAt: date,
              transcript: { bsonType: 'object' },
              instructor: { bsonType: 'object' },
            },
          },
        },
        progression: {
          bsonType: 'object',
          properties: {
            prerequisites: { bsonType: 'array', items: progressionEdge },
            nextSteps: { bsonType: 'array', items: progressionEdge },
            related: { bsonType: 'array', items: progressionEdge },
          },
        },
        source: strOrNull,
        audit: {
          bsonType: ['object', 'null'],
          properties: { networkReviewedAt: date },
        },
        url: str,
        createdAt: date,
        updatedAt: date,
        sportTypes: strArray,
      },
    },
    notes: [
      'Insert: routes/trickipedia.js POST / (admin only) writes writableFields(body) plus url, createdAt, updatedAt; validateTrick requires name, category, difficulty, description as strings and steps as an array, everything else defaults to [] or null, which is why the required list is long. Rows imported before the route existed can lack tutorials, progression and audit; apply with validationLevel moderate. PUT /:id $sets the same writable set plus url and updatedAt. Both enqueue graph_outbox trick.upserted.',
      'Script writers: scripts/migrate-trickipedia-network.js and scripts/migrate-skateboarding-network.js bulkWrite $set { progression, "audit.networkReviewedAt", updatedAt } for a hand-curated edge set (dry-run unless --apply); they resolve targets by name + category "Skateboarding" or by url slug and abort on a missing target.',
      'url: regenerated from name by generateSlug on every insert and update, so renaming a trick changes its public URL and orphans any tricks.link or kaori-rag webUrl built from the old slug. Looked up by GET /url/:slug and by the skateboarding migration.',
      'category and difficulty: free strings, not enums; the route never restricts them. Scripts filter category "Skateboarding"; routes/recommendations.js maps sport keys to "Skateboarding", "Snowboarding", "Surfing", "BMX", "Scooter", "Inline Skating", "Longboarding", "Wakeboarding"; difficulty is matched by /beginner|easy/ in recommendations and /beginner|easy|1/ in kaori-tools.',
      'progression edges: normalizeProgression writes { ...clientEdge, trickId: ObjectId, order, research }; strength defaults to "helpful" on prerequisites, relation is validated on related only. research is { status, confidence, evidence[], reviewedBy, reviewedAt } with status in draft|reviewed|published|disputed and confidence in high|medium|low (routes/trickipedia.js EDGE_STATUSES / EDGE_CONFIDENCE); scripts/check-trickipedia-invariants.js accepts "rejected" instead of "disputed", so the two lists disagree. Only reviewed|published edges reach GET /:id/network, services/graph/projector.js and recommendations. Left as an open object at that depth.',
      'research.evidence element shapes differ per writer: the route spreads the client item and adds checkedAt; migrate-trickipedia-network writes { sourceUrl, sourceType, note, checkedAt }; migrate-skateboarding-network writes { url, claim, checkedAt }.',
      'audit: the route writes body.audit || null. Both migration scripts $set "audit.networkReviewedAt", which mongod rejects with "Cannot create field" on any document where audit is null rather than absent or an object, so a route-created trick must have audit set before the scripts can touch it.',
      'tutorials: normalizeTutorials spreads the client tutorial and adds availability "active", embedAllowed, featured, lastVerifiedAt and transcript { status: "pending", ...client, retrievedAt }; validateTutorials requires canonicalUrl and platform, and instructor.credentialSourceUrl when instructor.isProfessional.',
      'sportTypes: legacy read only. GET /?sportType, services/graph/projector.js and services/graph/recommendations.js read sportTypes[0] || category, but no writer sets it on trickipedia (only spots and couch_videos write sportTypes).',
      'steps, tips, commonMistakes, safety, videos: arrays with client-defined elements (validateTrick checks only Array.isArray on steps, images, videos); kaori-rag/documents.js flattens them to text for the RAG index.',
      '_id is an auto ObjectId; no writer sets a custom one. Deleted by DELETE /:id (admin) with a graph_outbox trick.deleted event; personal tricks link by name only, so nothing cascades.',
      'Readers: routes/listing.js PUT /update (case-insensitive name match to find the canonical trick), kaori-tools.js, companion-graph/graph.js, scripts/build-companion-graph.js, scripts/rebuild-progression-graph.js, scripts/check-trickipedia-invariants.js, scripts/index-kaori-rag.js, routes/stats.js, mcp/public-tools.js (search_trickipedia).',
    ],
  },

  categories: {
    description: 'A trick category chip (name, icon, colours) for the app category picker.',
    writers: ['routes/categories.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['name', 'icon', 'backgroundColor', 'color'],
      properties: {
        _id: id,
        name: strOrNull,
        icon: strOrNull,
        backgroundColor: strOrNull,
        color: strOrNull,
      },
    },
    notes: [
      'Insert: routes/categories.js POST / (admin) after a truthiness check on all four fields. $set: PUT /:id (admin) writes { name, icon, backgroundColor, color } from req.body unconditionally.',
      'null: PUT /:id does not drop undefined keys and mongodb 4.13 serialises undefined as null (ignoreUndefined is false), so a partial PUT body nulls the fields it omits. That is the only way null reaches this collection; the insert never writes it.',
      '_id: auto ObjectId; GET /:id rejects anything ObjectId.isValid does not accept. No seed script in this repo. routes/spots.js SPOT_CATEGORIES is an in-code list for spots and unrelated.',
      'Nothing else in the repo reads categories; trickipedia.category is a free string, not a reference to this collection.',
    ],
  },

  graph_outbox: {
    description:
      'Transactional-outbox event that workers/graphProjector.js replays into Neo4j; idempotent on eventId.',
    writers: ['services/graph/outbox.js', 'workers/graphProjector.js'],
    jsonSchema: {
      bsonType: 'object',
      required: [
        'eventId',
        'type',
        'aggregateType',
        'aggregateId',
        'version',
        'payload',
        'status',
        'attempts',
        'availableAt',
        'createdAt',
      ],
      properties: {
        _id: id,
        eventId: str,
        type: { enum: ['trick.upserted', 'trick.deleted', 'rider.trick-status-changed'] },
        aggregateType: { enum: ['Trick', 'Rider'] },
        aggregateId: str,
        version: str,
        payload: {
          bsonType: 'object',
          properties: {
            riderId: str,
            trickId: str,
            trickName: str,
            landed: { bsonType: 'bool' },
          },
        },
        status: { enum: ['pending', 'processed', 'dead'] },
        attempts: counter,
        availableAt: date,
        createdAt: date,
        processedAt: date,
        lastError: str,
      },
    },
    notes: [
      'Single insert path: services/graph/outbox.js enqueueGraphEvent, an upsert on { eventId } with $setOnInsert, so re-enqueueing the same (type, aggregateId, version) is a no-op. eventId is the sha256 hex (64 chars) of "type:aggregateId:version"; _id is the auto ObjectId from the upsert. Callers: routes/trickipedia.js (trick.upserted on POST/PUT, trick.deleted on DELETE; version is the updatedAt ISO string; payload {}) and routes/listing.js PUT /update (rider.trick-status-changed; aggregateId is the rider userId string; version is "trickId:updatedAt ISO"; payload { riderId, trickId (trickipedia _id string), trickName, landed }).',
      'Status transitions in workers/graphProjector.js processBatch: pending to processed (+processedAt, attempts+1) on success; on failure attempts+1, availableAt pushed out by min(5 min, 2^attempts s), lastError truncated to 1000 chars, and dead once attempts reach 10. Nothing moves dead back to pending; GET /api/recommendations/graph-health only counts them.',
      'Indexes: ensureOutboxIndexes creates unique { eventId } and { status, availableAt, createdAt }, but only from workers/graphProjector.js start(), which returns before that when NEO4J_ENABLED is off. Enqueue is unconditional, so with the graph disabled events accumulate as pending forever and without the unique index.',
      'payload.landed is String(req.body.checked).toLowerCase() === "landed"; the current mobile client writes "Completed", so every rider event carries landed false and the LANDED edge is only ever deleted, never created, by projectLandedTrick.',
      'GRAPH_PROGRESSION_RUNBOOK.md documents the retry policy and the rebuild command (scripts/rebuild-progression-graph.js), which bypasses this collection.',
    ],
  },
};
