const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// A meaningful action is one of these; opening the app never counts.
// Mirrors docs/roadmap/retention-ltv (Weekly Progressing Riders).
const MEANINGFUL_EVENTS = Object.freeze([
  'trick_added',
  'trick_attempt_logged',
  'trick_landed',
  'spot_saved',
  'spot_directions_opened',
  'event_saved',
  'event_calendar_added',
  'ai_session_completed',
  'ai_response_completed',
  'post_created',
  'comment_created',
  'rider_followed',
  'homie_connected',
]);

// Weekly windows after signup. At a few dozen signups a month an exact-day
// window (D7 means "acted on day 7") reads zero by arithmetic, not behaviour.
const RETENTION_WINDOWS = Object.freeze([
  { label: 'W1', fromDay: 1, toDay: 7 },
  { label: 'W2', fromDay: 8, toDay: 14 },
  { label: 'W3', fromDay: 15, toDay: 21 },
  { label: 'W4', fromDay: 22, toDay: 28 },
]);

const ACTIVATION_HOURS = 48;

// Staff, bots and flagged QA accounts are labelled and excluded, never deleted.
const EXCLUDED_USER_FILTER = Object.freeze({
  $or: [{ role: 'admin' }, { isBot: true }, { analyticsExcluded: true }],
});

function excludedSummary(users) {
  const summary = { admins: 0, bots: 0, flagged: 0 };
  for (const user of users) {
    if (user.role === 'admin') summary.admins += 1;
    else if (user.isBot) summary.bots += 1;
    else if (user.analyticsExcluded) summary.flagged += 1;
  }
  return summary;
}

function groupActionsByUser(actions, excluded = new Set()) {
  const byUser = new Map();
  for (const action of actions) {
    const key = String(action.userId || '');
    if (!key || excluded.has(key)) continue;
    const at = new Date(action.timestamp || action.occurredAt).getTime();
    if (Number.isNaN(at)) continue;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(at);
  }
  return byUser;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)];
}

// signups: [{ _id, createdAt }], actions: [{ userId, timestamp }] (meaningful only).
function computeRetention({ signups, actions, now = Date.now(), excluded = new Set() }) {
  const nowMs = new Date(now).getTime();
  const byUser = groupActionsByUser(actions, excluded);
  const cohort = signups
    .filter((user) => !excluded.has(String(user._id)))
    .map((user) => ({ id: String(user._id), signupMs: new Date(user.createdAt).getTime() }))
    .filter((user) => !Number.isNaN(user.signupMs));

  const actedBetween = (user, fromMs, toMs) =>
    (byUser.get(user.id) || []).some((at) => at >= fromMs && at < toMs);

  const activationMs = ACTIVATION_HOURS * 60 * 60 * 1000;
  const activated = cohort.filter((user) =>
    actedBetween(user, user.signupMs, user.signupMs + activationMs),
  ).length;

  const hoursToValue = cohort
    .map((user) => {
      const first = (byUser.get(user.id) || []).filter((at) => at >= user.signupMs).sort()[0];
      return first === undefined ? null : (first - user.signupMs) / (60 * 60 * 1000);
    })
    .filter((hours) => hours !== null)
    .sort((a, b) => a - b);

  const retention = RETENTION_WINDOWS.map((window) => {
    const eligible = cohort.filter((user) => nowMs - user.signupMs >= (window.toDay + 1) * DAY_MS);
    const retained = eligible.filter((user) =>
      actedBetween(
        user,
        user.signupMs + window.fromDay * DAY_MS,
        user.signupMs + (window.toDay + 1) * DAY_MS,
      ),
    );
    return {
      ...window,
      day: window.toDay,
      eligible: eligible.length,
      retained: retained.length,
      rate: eligible.length ? retained.length / eligible.length : null,
    };
  });

  return {
    signups: cohort.length,
    activated,
    activationRate: cohort.length ? activated / cohort.length : 0,
    activationHours: ACTIVATION_HOURS,
    timeToValueHours: {
      p50: percentile(hoursToValue, 50),
      p90: percentile(hoursToValue, 90),
      measured: hoursToValue.length,
    },
    retention,
  };
}

// Rolling seven-day windows ending at `now`, oldest first.
function computeWeeklyProgressingRiders({ actions, now = Date.now(), weeks = 8, excluded }) {
  const toMs = new Date(now).getTime();
  const byUser = groupActionsByUser(actions, excluded);
  const series = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const weekEnd = toMs - index * WEEK_MS;
    const weekStart = weekEnd - WEEK_MS;
    let riders = 0;
    let count = 0;
    for (const timestamps of byUser.values()) {
      const inWindow = timestamps.filter((at) => at >= weekStart && at < weekEnd).length;
      if (inWindow) {
        riders += 1;
        count += inWindow;
      }
    }
    series.push({
      weekStart: new Date(weekStart).toISOString(),
      weekEnd: new Date(weekEnd).toISOString(),
      progressingRiders: riders,
      actions: count,
    });
  }
  const current = series[series.length - 1];
  return {
    weeks,
    current: {
      from: current.weekStart,
      to: current.weekEnd,
      progressingRiders: current.progressingRiders,
      actions: current.actions,
      depth: current.progressingRiders
        ? Math.round((current.actions / current.progressingRiders) * 100) / 100
        : 0,
    },
    series,
  };
}

module.exports = {
  ACTIVATION_HOURS,
  EXCLUDED_USER_FILTER,
  MEANINGFUL_EVENTS,
  RETENTION_WINDOWS,
  computeRetention,
  computeWeeklyProgressingRiders,
  excludedSummary,
};
