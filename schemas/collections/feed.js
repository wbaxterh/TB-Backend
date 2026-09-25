// schemas/collections/feed.js
// Derived from the write sites listed under `writers`; see schemas/README.md.

const id = { bsonType: 'objectId' };
const str = { bsonType: 'string' };
const strOrNull = { bsonType: ['string', 'null'] };
const date = { bsonType: 'date' };
const counter = { bsonType: 'int' };

module.exports = {
  feed_posts: {
    description: 'One user-generated feed post: a Bunny Stream video, an image, or a carousel.',
    writers: ['routes/feed.js'],
    jsonSchema: {
      bsonType: 'object',
      required: [
        'userId',
        'mediaType',
        'bunnyVideoId',
        'hlsUrl',
        'thumbnailUrl',
        'imageUrls',
        'caption',
        'sportTypes',
        'tricks',
        'location',
        'duration',
        'aspectRatio',
        'stats',
        'engagement',
        'spotId',
        'trickIds',
        'visibility',
        'status',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: id,
        userId: { bsonType: ['string', 'objectId'] },
        mediaType: { enum: ['video', 'image', 'carousel'] },
        bunnyVideoId: strOrNull,
        hlsUrl: strOrNull,
        thumbnailUrl: strOrNull,
        imageUrls: { bsonType: 'array', items: str },
        caption: str,
        sportTypes: { bsonType: 'array', items: str },
        tricks: { bsonType: 'array' },
        location: { bsonType: ['object', 'string', 'null'] },
        duration: { bsonType: ['number', 'null'] },
        aspectRatio: str,
        stats: {
          bsonType: 'object',
          properties: {
            loveCount: counter,
            respectCount: counter,
            commentCount: counter,
            shareCount: counter,
            viewCount: counter,
            saveCount: counter,
          },
        },
        engagement: {
          bsonType: 'object',
          properties: {
            completionRate: { bsonType: 'number' },
            rewatchRate: { bsonType: 'number' },
            skipRate: { bsonType: 'number' },
          },
        },
        spotId: strOrNull,
        trickIds: { bsonType: 'array', items: str },
        visibility: str,
        status: { enum: ['published', 'processing'] },
        createdAt: date,
        updatedAt: date,
      },
    },
    notes: [
      'Single insert site: POST /api/feed in routes/feed.js. $set sites: PUT /:postId (caption, visibility, sportTypes, tricks, spotId, trickIds, updatedAt), POST /:postId/link-tricks (trickIds), POST /:postId/link-spot (spotId). $inc sites touch stats.* only.',
      'userId: routes/feed.js writes req.user.userId (string). routes/user.js counts by string first and falls back to new ObjectId(id), with a comment that production holds both shapes. Target: objectId.',
      'spotId and trickIds entered the insert in 36a44f2 (2026-03-24); posts created 2026-01-20 to 2026-03-24 lack both keys. Backfill or apply with validationLevel moderate before enforcing required.',
      'visibility: written as req.body.visibility || "public" with no validation. Readers only understand "public" and "homies" (routes/feed.js GET / and GET /user/:userId); any other value is invisible to everyone but the author.',
      'status: "published" when hlsUrl or imageUrls is supplied at insert, else "processing". No code in this repo ever moves a post out of "processing"; PUT /:postId does not allow status or hlsUrl.',
      'stats counters: inserted as 0 and only ever $inc by +1/-1, so they stay int32. stats.shareCount has no writer beyond the insert.',
      'engagement: inserted as zeros and never updated; POST /:postId/view only $inc stats.viewCount and ignores watchDuration/completed. calculateFeedScore still reads engagement.completionRate.',
      'sportTypes: SPORT_TYPES (9 sports) is enforced only on GET /trending and GET /sport/:sportType filters, not on write.',
      'tricks and location: raw req.body passthrough with no validation; element and object shape are client-defined.',
      'Response-only fields never persisted: user, spot, linkedTricks, userReactions, signedHlsUrl, signedMp4Url, signedThumbnailUrl (populatePostUsers, services/bunnyStream.js getVideoUrls).',
      'Readers: routes/user.js (stats, activity), routes/analytics.js (distinct userId by createdAt).',
    ],
  },

  reactions: {
    description: 'One love or respect reaction by one user on one feed post.',
    writers: ['routes/feed.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['postId', 'userId', 'type', 'createdAt'],
      properties: {
        _id: id,
        postId: { bsonType: ['string', 'objectId'] },
        userId: str,
        type: { enum: ['love', 'respect'] },
        createdAt: date,
      },
    },
    notes: [
      'Insert: POST /:postId/reaction in routes/feed.js writes postId (req.params, string) and userId (req.user.userId, string). Delete: DELETE /:postId/reaction/:type and deleteMany on post delete.',
      'postId: only string is written; routes/user.js activity wraps r.postId in new ObjectId() with a try/catch fallback, so ObjectId is tolerated on read. Target: objectId.',
      'Uniqueness of (postId, userId, type) is enforced by a findOne-then-insert check, not an index.',
      'Readers: routes/feed.js GET / (userReactions), routes/user.js activity, routes/analytics.js activeUserCount.',
    ],
  },

  comments: {
    description: 'One comment or reply on a feed post; soft-deleted via status.',
    writers: ['routes/feed.js'],
    jsonSchema: {
      bsonType: 'object',
      required: [
        'postId',
        'userId',
        'parentCommentId',
        'content',
        'loveCount',
        'replyCount',
        'status',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: id,
        postId: str,
        userId: str,
        parentCommentId: strOrNull,
        content: str,
        loveCount: counter,
        replyCount: counter,
        status: { enum: ['active', 'deleted'] },
        createdAt: date,
        updatedAt: date,
      },
    },
    notes: [
      'Insert: POST /:postId/comments in routes/feed.js. $set: DELETE /:postId/comments/:commentId sets status "deleted" and updatedAt. $inc: loveCount (comment love toggle), replyCount (reply insert).',
      'content is trimmed and capped at 500 chars on write. parentCommentId is the parent comment _id as a string, null for top-level.',
      'Soft delete of a reply does not decrement the parent replyCount; deleteMany on post delete is a hard delete.',
      'This is the live comment collection; routes/user.js reads a different name, feed_comments, see that entry.',
      'Readers: routes/feed.js, routes/analytics.js (distinct userId by createdAt).',
    ],
  },

  feed_comments: {
    description:
      'Read-only in this repo: the name routes/user.js queries for a user activity feed; nothing writes it.',
    writers: [],
    jsonSchema: {
      bsonType: 'object',
      required: [],
      properties: {
        _id: id,
        userId: str,
        postId: { bsonType: ['string', 'objectId'] },
        content: str,
        isDeleted: { bsonType: 'bool' },
        createdAt: date,
      },
    },
    notes: [
      'No insert or $set site anywhere in the repo. Only reader: routes/user.js GET /:id/activity, added in c4b776b (2026-01-23), which queries { userId, isDeleted: { $ne: true } }.',
      'Every field is legacy: read only. The live comment collection is comments, which uses status "active"/"deleted" rather than isDeleted, so this lane of the activity feed returns nothing unless the collection was created out of band.',
      'Likely a stale alias of comments; candidate for deletion once routes/user.js is repointed.',
    ],
  },

  comment_loves: {
    description: 'One love by one user on one comment; toggled by insert/delete.',
    writers: ['routes/feed.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['commentId', 'userId', 'createdAt'],
      properties: {
        _id: id,
        commentId: str,
        userId: str,
        createdAt: date,
      },
    },
    notes: [
      'Insert and deleteOne both live in POST /:postId/comments/:commentId/love in routes/feed.js; the handler toggles on findOne({ commentId, userId }).',
      'commentId is the comment _id as a string (req.params). Not cleaned up when a comment is soft-deleted or its post is hard-deleted.',
      'No unique index is created in code; concurrent taps can double-insert and drift comments.loveCount.',
    ],
  },

  saved_posts: {
    description: 'One bookmark of a feed post by a user.',
    writers: ['routes/feed.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['postId', 'userId', 'savedAt'],
      properties: {
        _id: id,
        postId: str,
        userId: str,
        savedAt: date,
      },
    },
    notes: [
      'Only write is an upsert in POST /:postId/save: updateOne({ postId, userId }, { $set: { postId, userId, savedAt } }, { upsert: true }). Both ids are strings.',
      'The handler $inc feed_posts.stats.saveCount on every save call, including when the upsert matched an existing document, so saveCount overcounts repeat saves.',
      'Reader: GET /saved in routes/feed.js, sorted by savedAt. Deleted with the post via deleteMany({ postId }).',
    ],
  },

  reports: {
    description: 'One user report against a feed post.',
    writers: ['routes/feed.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['postId', 'reportedBy', 'reason', 'status', 'createdAt'],
      properties: {
        _id: id,
        postId: str,
        reportedBy: str,
        reason: str,
        status: str,
        createdAt: date,
      },
    },
    notes: [
      'Single insert site: POST /:postId/report in routes/feed.js. reportedBy is req.user.userId (string), postId is req.params (string).',
      'reason: only truthiness is checked on write; no enum in code. Typed string because clients send free text.',
      'status: only "pending" is ever written and nothing in this repo reads or resolves reports, so other values can only come from manual edits. Left as string for that reason.',
    ],
  },

  posts: {
    description:
      'Read-only in this repo: a mis-named reference to feed_posts in the companion graph audit script.',
    writers: [],
    jsonSchema: {
      bsonType: 'object',
      required: [],
      properties: {
        _id: id,
        trickIds: { bsonType: 'array' },
        spotId: { bsonType: ['string', 'objectId', 'null'] },
      },
    },
    notes: [
      'Only reference: scripts/audit-companion-graph.js (78874d8, 2026-09-10) does countDocuments, findOne, and countDocuments({ "trickIds.0": { $exists: true }, spotId: { $ne: null } }).',
      'That predicate is the feed_posts shape (trickIds and spotId were added there in 36a44f2). No route, worker, socket, or MCP tool reads or writes posts, and git history has no other reference.',
      'Not a legacy collection this code ever wrote; the audit linkedPosts figure reads 0 until the script is pointed at feed_posts. All fields legacy: read only.',
    ],
  },
};
