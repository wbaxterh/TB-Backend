/**
 * Default notification preferences applied at user creation and used as the
 * shape contract for the prefs subdoc. Spec: docs/docs/features/notifications.md §4.1.
 */

const CATEGORIES = ['messages', 'reminders'];

function buildDefaultNotificationPreferences() {
  return {
    messages: { push: true, inApp: true, email: false },
    reminders: { push: true, inApp: false, email: false },
    quietHours: { start: '21:00', end: '09:00', timezone: 'America/New_York' },
    osPermission: { ios: 'unknown', android: 'unknown', web: 'unknown' },
    updatedAt: new Date(),
  };
}

/**
 * Returns true if `now` falls inside the user's quiet-hours window.
 * Handles wrap-around (e.g. 21:00 – 09:00).
 * Reminders should be suppressed; messages should not.
 */
function isInQuietHours(prefs, now = new Date()) {
  const qh = prefs?.quietHours;
  if (!qh?.start || !qh?.end) return false;

  const tz = qh.timezone || 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  }).formatToParts(now);

  const hh = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const cur = hh * 60 + mm;

  const [sh, sm] = qh.start.split(':').map(Number);
  const [eh, em] = qh.end.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  // wraps midnight
  return cur >= start || cur < end;
}

module.exports = {
  CATEGORIES,
  buildDefaultNotificationPreferences,
  isInQuietHours,
};
