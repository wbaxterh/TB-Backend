// schemas/collections/social.js
// Derived from the write sites listed under `writers`; see schemas/README.md.
module.exports = {
  conversations: {
    description: 'One DM thread: a 1:1, a message request, a homies group, or a user-to-bot chat.',
    writers: ['routes/dm.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['participants', 'lastMessage', 'unreadCount', 'createdAt', 'updatedAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        participants: { bsonType: 'array', items: { bsonType: 'string' } },
        isGroup: { bsonType: 'bool' },
        groupName: { bsonType: 'string' },
        createdBy: { bsonType: 'string' },
        admins: { bsonType: 'array', items: { bsonType: 'string' } },
        lastMessage: {
          bsonType: ['object', 'null'],
          properties: {
            content: { bsonType: 'string' },
            type: { bsonType: 'string', enum: ['text', 'shared'] },
            senderId: { bsonType: 'string' },
            createdAt: { bsonType: 'date' },
          },
        },
        unreadCount: { bsonType: 'object' },
        isRequest: { bsonType: 'bool' },
        requestedBy: { bsonType: 'string' },
        isBot: { bsonType: 'bool' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
    notes: [
      'Three insert sites, all in routes/dm.js: POST /conversations group branch (adds isGroup, groupName, createdBy, admins, isRequest: false), POST /conversations 1:1 branch (adds isRequest and requestedBy when the target is neither a homie nor a bot), and POST /bot-conversation (adds isBot: true, omits isRequest). Only the five shared keys are required.',
      'participants are JWT userId strings everywhere (routes compare them with !== against req.user.userId and wrap with new ObjectId() to join users), never ObjectIds. kaori-ai-response.js relies on this with $all: [senderId, botId]. Target: keep string until users._id joins are migrated in one pass.',
      'unreadCount is a map keyed by participant id string with int values; it is $inc-ed per recipient on send, $set to 0 on read, and extended with `unreadCount.<id>: 0` when members are added. Keys cannot be enumerated in a schema.',
      'lastMessage starts null and is $set on every send; lastMessage.content is the preview string (message text, or the emoji label for shared content), so it is never null once set.',
      'Dedupe differs per endpoint: the 1:1 branch sorts the pair and matches the exact array, /bot-conversation matches $all in insertion order. The same user+bot pair can therefore exist twice; kaori-ai-response.js already picks the most recently updated one.',
      '$addToSet participants (add members), $set groupName (rename) and $set isRequest: false (accept, or recipient reply) are the only other mutations. Decline deletes the document and its dm_messages outright.',
    ],
  },

  dm_messages: {
    description:
      'One message inside a conversation, sent by a user or a bot; read state lives on the message.',
    writers: ['routes/dm.js'],
    jsonSchema: {
      bsonType: 'object',
      required: [
        'conversationId',
        'senderId',
        'content',
        'type',
        'sharedContent',
        'status',
        'readAt',
        'createdAt',
      ],
      properties: {
        _id: { bsonType: 'objectId' },
        conversationId: { bsonType: 'string' },
        senderId: { bsonType: 'string' },
        content: { bsonType: ['string', 'null'] },
        type: { bsonType: 'string', enum: ['text', 'shared'] },
        sharedContent: {
          bsonType: ['object', 'null'],
          properties: {
            contentType: {
              bsonType: 'string',
              enum: ['tricklist', 'trick', 'spot', 'spotlist', 'video'],
            },
            contentId: { bsonType: 'string' },
            preview: { bsonType: 'object' },
          },
        },
        status: { bsonType: 'string', enum: ['sent', 'read'] },
        readAt: { bsonType: ['date', 'null'] },
        createdAt: { bsonType: 'date' },
      },
    },
    notes: [
      'Three insert sites, all in routes/dm.js: the user send, the in-process bot reply, and the /bot-conversation greeting. All three write the same eight keys, so every one is required.',
      'conversationId is the conversation _id as a hex string (req.params or insertedId.toString()), and senderId is the JWT string; both are queried as strings. Target: objectId for both.',
      'content is null only when a message carries sharedContent and no text; type is derived from whether sharedContent is present.',
      'sharedContent is client-supplied: only contentType (enum) and a truthy contentId are validated, and preview is whatever the client sent (preview.title is read for the conversation preview). It is stored as-is.',
      'Read state is per message: PUT /conversations/:id/read $sets status: read and readAt on every message not sent by the reader. There is no readBy array; the readBy name only exists as the socket payload of messages:read in socket/messageSocket.js.',
      'The route overwrites message._id with insertedId.toString() after insert for the socket payload; the stored _id is still an ObjectId.',
      'socket/*.js and store/messages.js never touch this collection (the store is an in-memory boilerplate stub).',
    ],
  },

  bot_chats: {
    description:
      'One turn of the mobile/3D-stage companion chat; user and bot turns are separate documents.',
    writers: ['routes/botChat.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['fromUserId', 'toUserId', 'message', 'type', 'createdAt', 'updatedAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        fromUserId: { bsonType: 'string' },
        toUserId: { bsonType: 'string' },
        userId: { bsonType: 'string' },
        message: { bsonType: 'string' },
        type: { bsonType: 'string', enum: ['user', 'bot'] },
        richContent: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              type: { bsonType: 'string', enum: ['video_card', 'trick_card', 'spot_card'] },
              data: { bsonType: 'object' },
            },
          },
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
    notes: [
      'There is no `messages` array: POST /api/bot-chat/message inserts one document for the user turn (type: user) and one for the reply (type: bot). History is reassembled by sorting on createdAt with the fromUserId/toUserId pair in either direction.',
      'userId is written only on the user turn (duplicating fromUserId); the bot turn omits it. routes/analytics.js activeUserCount() does distinct("userId") on this collection, which is why the field exists.',
      'fromUserId/toUserId are the JWT string and the botId string from the request body (validated by loading users with isBot: true). Target: objectId.',
      'richContent is attached to the bot turn only when kaori-ai-response.js accumulateCards() produced at least one card; data carries the card fields (_id as a string plus title/name and a few preview fields), capped at 6 cards and 4 per type.',
      'updatedAt is set equal to createdAt at insert and never updated; routes/analytics.js sorts on it for latest activity.',
    ],
  },

  companion_profiles: {
    description:
      'Per (user, bot) relationship memory that Kaori reads to adapt tone and recall facts.',
    writers: ['routes/companionProfile.js', 'kaori-ai-response.js', 'kaori-tools.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'companionId'],
      properties: {
        _id: { bsonType: 'objectId' },
        userId: { bsonType: 'string' },
        companionId: { bsonType: 'string' },
        relationshipStage: {
          bsonType: 'string',
          enum: ['stranger', 'acquaintance', 'friend', 'close_friend', 'bestie'],
        },
        interactionCount: { bsonType: 'int' },
        traits: {
          bsonType: 'object',
          properties: {
            preferredTopics: { bsonType: 'array', items: { bsonType: 'string' } },
            communicationStyle: { bsonType: 'string' },
            humorLevel: { bsonType: 'string' },
            emotionalOpenness: { bsonType: 'string' },
            sports: { bsonType: 'array', items: { bsonType: 'string' } },
          },
        },
        memory: {
          bsonType: 'object',
          properties: {
            userName: { bsonType: 'string' },
            knownFacts: { bsonType: 'array', items: { bsonType: 'string' } },
            lastTrickDiscussed: { bsonType: 'string' },
            lastSessionMood: { bsonType: 'string' },
          },
        },
        greetingStyle: { bsonType: 'string' },
        firstInteraction: { bsonType: ['date', 'null'] },
        lastInteraction: { bsonType: ['date', 'null'] },
        createdAt: { bsonType: 'date' },
      },
    },
    notes: [
      '_id is the default ObjectId; identity is the unique index on (userId, companionId). No writer sets a custom _id.',
      'Four insert paths with different shapes: GET /profile/:companionId insertOne writes the full default document; PUT /profile/:companionId findOneAndUpdate upsert writes only userId, companionId and whichever of memory/traits/greetingStyle the body had; kaori-ai-response.js name capture upserts memory.userName with $setOnInsert relationshipStage/interactionCount/createdAt; kaori-tools.js remember_user_info upserts memory.userName, traits.sports and $addToSet memory.knownFacts. Only userId and companionId are common, so nothing else can be required; readers default the rest.',
      'companionId is the bot users._id as a hex string (URL param in the route, options.botId or the hardcoded Kaori id 69c15e55c7ebe2c6884f1267 in kaori-ai-response.js and kaori-tools.js). It is not a companion-registry character id, and companion-registry.js currently registers only kaori, so no enum applies. userId is the JWT string. Target: objectId for both.',
      'PUT /profile/:companionId $sets memory and traits wholesale from the client body with no validation, so the nested shapes above describe what the server writes, not what a client may have replaced them with.',
      'kaori-ai-response.js $sets interactionCount (+1), relationshipStage (computeStage), lastInteraction, and firstInteraction on first contact, but only when a profile already exists (no upsert on that path).',
    ],
  },
};
