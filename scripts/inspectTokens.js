const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');

(async () => {
  const c = new MongoClient(process.env.ATLAS_URI);
  await c.connect();
  const db = c.db('TrickList2');

  const tokens = await db.collection('pushTokens').find({}).toArray();
  console.log('=== pushTokens rows ===');
  console.log('Total:', tokens.length);
  for (const t of tokens) {
    console.log(
      JSON.stringify({
        _id: String(t._id),
        userId: String(t.userId),
        platform: t.platform,
        transport: t.transport,
        deviceModel: t.deviceModel,
        tokenPrefix: t.token ? t.token.slice(0, 30) + '...' : null,
        lastSeenAt: t.lastSeenAt,
        deadAt: t.deadAt,
        deadReason: t.deadReason,
      }),
    );
  }

  console.log('=== users with notificationPreferences set ===');
  const userCount = await db
    .collection('users')
    .countDocuments({ notificationPreferences: { $exists: true } });
  console.log('count:', userCount);

  console.log('=== recent ticket log (last 5) ===');
  const tickets = await db
    .collection('notificationDeliveryLog')
    .find({})
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();
  for (const t of tickets) {
    console.log(
      JSON.stringify({
        ticketId: t.ticketId,
        status: t.status,
        errorCode: t.errorCode,
        errorMessage: t.errorMessage,
        receiptStatus: t.receiptStatus,
        receiptError: t.receiptError,
        createdAt: t.createdAt,
      }),
    );
  }

  await c.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
