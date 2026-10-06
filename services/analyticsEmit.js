const crypto = require('node:crypto');
const { normalizeEvent } = require('./analyticsContracts');

// Best-effort guess at the client platform from the user agent, for events the
// server records on a client's behalf (the clients cannot know, for example,
// that a sign-in just created the account).
function platformFromRequest(req) {
  const ua = String(req?.get?.('user-agent') || req?.headers?.['user-agent'] || '').toLowerCase();
  if (/android|okhttp/.test(ua)) return 'android';
  if (/expo|cfnetwork|darwin|iphone|ipad/.test(ua)) return 'ios';
  return 'web';
}

// Records an analytics event server-side. Never throws: analytics must not
// change the outcome of the request that produced it.
async function emitServerEvent(db, { name, userId, properties = {}, req, platform }) {
  try {
    const doc = normalizeEvent(
      {
        name,
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        properties,
        source: { origin: 'server' },
      },
      {
        userId: userId ? String(userId) : null,
        platform: platform || platformFromRequest(req),
        userAgent: req?.get?.('user-agent'),
      },
    );
    await db
      .collection('analytics_events')
      .updateOne({ eventId: doc.eventId }, { $setOnInsert: doc }, { upsert: true });
    return doc;
  } catch (error) {
    console.error(`[analytics] server event ${name} not recorded:`, error.message);
    return null;
  }
}

module.exports = { emitServerEvent, platformFromRequest };
