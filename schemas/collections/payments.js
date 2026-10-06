// schemas/collections/payments.js
// Derived from the write sites listed under `writers`; see schemas/README.md.
module.exports = {
  stripe_events: {
    description:
      'Stripe webhook deliveries already handled, keyed by Stripe event id so retries and duplicate deliveries are ignored.',
    writers: ['routes/payments.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['eventId', 'type', 'livemode', 'receivedAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        eventId: { bsonType: 'string' },
        type: { bsonType: 'string' },
        livemode: { bsonType: 'bool' },
        receivedAt: { bsonType: 'date' },
      },
    },
    notes: [
      'Unique index on eventId; TTL index on receivedAt (90 days). Both are created in the route factory.',
      'A row is inserted before the handler runs and deleted if the handler throws, so a Stripe retry can process the event.',
    ],
  },
};
