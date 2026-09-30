// schemas/collections/kaori.js
// Ephemeral quota state and the audit trail written by services/kaoriUsage.js.

const date = { bsonType: 'date' };
const str = { bsonType: 'string' };

module.exports = {
  kaori_usage_counters: {
    description: 'Atomic per-minute, daily, and monthly counters used to cap Kaori spend.',
    writers: ['services/kaoriUsage.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['count', 'createdAt', 'expiresAt'],
      properties: {
        _id: str,
        count: { bsonType: ['int', 'long', 'double'], minimum: 0 },
        createdAt: date,
        updatedAt: date,
        expiresAt: date,
      },
    },
    notes: [
      'expiresAt has a TTL index; counter identifiers contain only user ids or hashed devices.',
    ],
  },

  kaori_generation_leases: {
    description: 'Short-lived per-account lock that prevents concurrent AI generations.',
    writers: ['services/kaoriUsage.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'requestId', 'deviceKey', 'surface', 'createdAt', 'expiresAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        userId: str,
        requestId: str,
        deviceKey: str,
        surface: str,
        createdAt: date,
        expiresAt: date,
      },
    },
    notes: ['Unique on userId and deleted automatically through the expiresAt TTL index.'],
  },

  kaori_usage_events: {
    description: 'Reservation, settlement, refund, and voice-use audit events for Kaori.',
    writers: ['services/kaoriUsage.js'],
    jsonSchema: {
      bsonType: 'object',
      required: [
        'requestId',
        'userId',
        'surface',
        'kind',
        'tier',
        'status',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: { bsonType: 'objectId' },
        requestId: str,
        userId: str,
        deviceKey: str,
        surface: str,
        kind: { enum: ['text_generation', 'voice_reply'] },
        tier: { enum: ['free', 'premium'] },
        status: { enum: ['reserved', 'settled', 'refunded'] },
        responseChars: { bsonType: ['int', 'long', 'double'], minimum: 0 },
        voiceRequested: { bsonType: 'bool' },
        reason: str,
        createdAt: date,
        updatedAt: date,
        settledAt: date,
        refundedAt: date,
      },
    },
    notes: [
      'requestId is unique; deviceKey is a one-way privacy hash rather than a raw device id.',
    ],
  },
};
