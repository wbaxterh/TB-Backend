/**
 * Notification sender — the ONLY module that calls expo-server-sdk for sending.
 *
 * - Reads server-side prefs (skip if category is toggled off).
 * - Suppresses reminders during quiet hours; messages bypass quiet hours.
 * - Drops malformed tokens via Expo.isExpoPushToken.
 * - Chunks via expo.chunkPushNotifications (≤100 per Expo hard cap).
 * - Persists ticket IDs so the receipts worker can detect DeviceNotRegistered.
 *
 * Spec: docs/docs/features/notifications.md §6.1
 */

const { Expo } = require('expo-server-sdk');
const { ObjectId } = require('mongodb');
const { isInQuietHours } = require('./notificationDefaults');

const expo = new Expo();
const TICKETS_COLLECTION = 'notificationDeliveryLog';
const TOKENS_COLLECTION = 'pushTokens';
const USERS_COLLECTION = 'users';

let _db = null;

function init(db) {
  _db = db;

  // Indexes — fire-and-forget; safe to retry on every boot.
  db.collection(TOKENS_COLLECTION)
    .createIndex({ userId: 1, platform: 1 }, { background: true })
    .catch(() => {});
  db.collection(TOKENS_COLLECTION)
    .createIndex({ token: 1 }, { unique: true, background: true })
    .catch(() => {});
  db.collection(TOKENS_COLLECTION)
    .createIndex({ deadAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, background: true })
    .catch(() => {});

  db.collection(TICKETS_COLLECTION)
    .createIndex({ ticketId: 1 }, { unique: true, sparse: true, background: true })
    .catch(() => {});
  db.collection(TICKETS_COLLECTION)
    .createIndex({ status: 1, createdAt: 1 }, { background: true })
    .catch(() => {});
  db.collection(TICKETS_COLLECTION)
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, background: true })
    .catch(() => {});
}

function db() {
  if (!_db) throw new Error('notificationSender not initialized — call init(db) at startup');
  return _db;
}

function toUserObjectId(userId) {
  if (userId instanceof ObjectId) return userId;
  try {
    return new ObjectId(String(userId));
  } catch {
    return null;
  }
}

/**
 * Compute the platform-specific message body for a single token.
 * Spec: §7.1 (iOS), §7.2 (Android).
 */
function buildMessage(
  tokenDoc,
  { title, body, data, threadId, channelId, interruptionLevel, badge, sound = 'default' },
) {
  const msg = {
    to: tokenDoc.token,
    title,
    body,
    data: data || {},
    sound,
    priority: 'high',
  };

  // iOS
  if (tokenDoc.platform === 'ios') {
    if (threadId) msg.threadId = threadId;
    if (interruptionLevel) msg._contentAvailable = false;
    if (interruptionLevel) msg.interruptionLevel = interruptionLevel; // active|timeSensitive|passive|critical
    if (typeof badge === 'number') msg.badge = badge;
  }

  // Android
  if (tokenDoc.platform === 'android') {
    if (channelId) msg.channelId = channelId; // 'messages' | 'reminders'
  }

  return msg;
}

async function getPrefs(userId) {
  const _id = toUserObjectId(userId);
  if (!_id) return null;
  const user = await db()
    .collection(USERS_COLLECTION)
    .findOne({ _id }, { projection: { notificationPreferences: 1 } });
  return user?.notificationPreferences || null;
}

async function getLiveTokens(userId, platform) {
  const q = { userId: toUserObjectId(userId), deadAt: null };
  if (platform) q.platform = platform;
  return db().collection(TOKENS_COLLECTION).find(q).toArray();
}

async function persistTickets(tickets, userId, category, tokensInOrder) {
  if (!tickets?.length) return;
  const now = new Date();
  const docs = tickets.map((t, i) => ({
    ticketId: t.status === 'ok' ? t.id : null,
    status: t.status, // 'ok' | 'error'
    errorCode: t.status === 'error' ? t.details?.error || null : null,
    errorMessage: t.status === 'error' ? t.message || null : null,
    userId: toUserObjectId(userId),
    category,
    token: tokensInOrder[i]?.token || null,
    pushTokenId: tokensInOrder[i]?._id || null,
    createdAt: now,
    receiptStatus: t.status === 'ok' ? 'pending' : 'skipped',
  }));
  try {
    await db().collection(TICKETS_COLLECTION).insertMany(docs, { ordered: false });
  } catch (err) {
    // Dup ticket IDs are fine (retries); other errors are logged but non-fatal.
    if (err?.code !== 11000)
      console.error('[notificationSender] persistTickets warn:', err.message);
  }

  // Immediate cleanup for tokens the push service already knows are dead.
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (
      t.status === 'error' &&
      t.details?.error === 'DeviceNotRegistered' &&
      tokensInOrder[i]?._id
    ) {
      await db()
        .collection(TOKENS_COLLECTION)
        .updateOne(
          { _id: tokensInOrder[i]._id },
          { $set: { deadAt: new Date(), deadReason: 'DeviceNotRegistered' } },
        )
        .catch(() => {});
    }
  }
}

/**
 * Send a notification to one user across all their live tokens.
 *
 * @param {Object} args
 * @param {string|ObjectId} args.userId
 * @param {'messages'|'reminders'} args.category
 * @param {string} args.title
 * @param {string} args.body
 * @param {Object} [args.data]            Tap-payload (e.g. { url: '/messages/abc', category: 'messages' })
 * @param {string} [args.threadId]        iOS grouping (conversation id, list id)
 * @param {string} [args.channelId]       Android channel ('messages' | 'reminders')
 * @param {string} [args.interruptionLevel] iOS: 'active'|'timeSensitive'|'passive'|'critical'
 * @param {number} [args.badge]
 * @param {string|ObjectId} [args.fromUserId] If equals userId, send is skipped (no self-notify).
 * @param {boolean} [args.bypassQuietHours=false]
 * @returns {Promise<{ sent: number, skipped: string|null, tickets: Array }>}
 */
async function send(args) {
  const {
    userId,
    category,
    title,
    body,
    data,
    threadId,
    channelId,
    interruptionLevel,
    badge,
    fromUserId,
    bypassQuietHours = false,
  } = args;

  if (!userId || !category) throw new Error('send: userId and category required');
  if (fromUserId && String(fromUserId) === String(userId)) {
    return { sent: 0, skipped: 'self-notify', tickets: [] };
  }

  const prefs = await getPrefs(userId);
  if (prefs && prefs[category]?.push === false) {
    return { sent: 0, skipped: 'in-app-pref-off', tickets: [] };
  }

  if (!bypassQuietHours && category === 'reminders' && prefs && isInQuietHours(prefs)) {
    return { sent: 0, skipped: 'quiet-hours', tickets: [] };
  }

  const allTokens = await getLiveTokens(userId);
  if (allTokens.length === 0) return { sent: 0, skipped: 'no-tokens', tickets: [] };

  const expoTokens = allTokens.filter(
    (t) => (t.transport === 'expo' || !t.transport) && Expo.isExpoPushToken(t.token),
  );
  if (expoTokens.length === 0) return { sent: 0, skipped: 'no-expo-tokens', tickets: [] };

  const messages = expoTokens.map((t) =>
    buildMessage(t, { title, body, data, threadId, channelId, interruptionLevel, badge }),
  );
  const chunks = expo.chunkPushNotifications(messages);

  const tickets = [];
  const tokensInOrder = [];
  let cursor = 0;
  for (const chunk of chunks) {
    try {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
      tokensInOrder.push(...expoTokens.slice(cursor, cursor + chunk.length));
    } catch (err) {
      console.error('[notificationSender] chunk send failed:', err?.message || err);
      // Synthesize error tickets so persistTickets still records them.
      for (let i = 0; i < chunk.length; i++) {
        tickets.push({ status: 'error', message: err?.message || 'send_failed' });
        tokensInOrder.push(expoTokens[cursor + i]);
      }
    }
    cursor += chunk.length;
  }

  await persistTickets(tickets, userId, category, tokensInOrder);

  const ok = tickets.filter((t) => t.status === 'ok').length;
  return { sent: ok, skipped: null, tickets };
}

module.exports = {
  init,
  send,
  // exposed for the receipts worker
  _internals: { expo, TICKETS_COLLECTION, TOKENS_COLLECTION },
};
