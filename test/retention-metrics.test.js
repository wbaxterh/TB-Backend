const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MEANINGFUL_EVENTS,
  RETENTION_WINDOWS,
  computeRetention,
  computeWeeklyProgressingRiders,
  excludedSummary,
} = require('../services/retentionMetrics');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-06T12:00:00Z');
const daysAgo = (days) => new Date(NOW - days * DAY);
const action = (userId, when) => ({ userId, event: 'trick_landed', timestamp: when });

test('meaningful events never include merely opening the app', () => {
  assert.ok(MEANINGFUL_EVENTS.includes('trick_landed'));
  assert.ok(!MEANINGFUL_EVENTS.includes('app_opened'));
  assert.deepEqual(
    RETENTION_WINDOWS.map((w) => w.label),
    ['W1', 'W2', 'W3', 'W4'],
  );
});

test('a rider who acts on day 5 counts as retained in week one', () => {
  const signups = [{ _id: 'a', createdAt: daysAgo(40) }];
  const actions = [action('a', daysAgo(35))];
  const { retention } = computeRetention({ signups, actions, now: NOW });
  const w1 = retention.find((w) => w.label === 'W1');
  assert.equal(w1.eligible, 1);
  assert.equal(w1.retained, 1);
  assert.equal(w1.day, 7);
  const w2 = retention.find((w) => w.label === 'W2');
  assert.equal(w2.retained, 0);
});

test('a window is only eligible once it has fully elapsed', () => {
  const signups = [{ _id: 'fresh', createdAt: daysAgo(3) }];
  const { retention } = computeRetention({ signups, actions: [], now: NOW });
  assert.ok(retention.every((w) => w.eligible === 0));
  assert.ok(retention.every((w) => w.rate === null));
});

test('activation is a meaningful action within 48 hours, and time to value is measured', () => {
  const signups = [
    { _id: 'fast', createdAt: daysAgo(10) },
    { _id: 'slow', createdAt: daysAgo(10) },
    { _id: 'never', createdAt: daysAgo(10) },
  ];
  const actions = [
    action('fast', new Date(daysAgo(10).getTime() + 6 * 60 * 60 * 1000)),
    action('slow', daysAgo(5)),
  ];
  const metrics = computeRetention({ signups, actions, now: NOW });
  assert.equal(metrics.signups, 3);
  assert.equal(metrics.activated, 1);
  assert.equal(metrics.activationHours, 48);
  assert.equal(metrics.timeToValueHours.measured, 2);
  assert.equal(metrics.timeToValueHours.p50, 6);
  assert.equal(metrics.timeToValueHours.p90, 120);
});

test('excluded accounts leave both the cohort and the action set', () => {
  const signups = [
    { _id: 'admin', createdAt: daysAgo(20) },
    { _id: 'rider', createdAt: daysAgo(20) },
  ];
  const actions = [action('admin', daysAgo(18)), action('rider', daysAgo(18))];
  const metrics = computeRetention({
    signups,
    actions,
    now: NOW,
    excluded: new Set(['admin']),
  });
  assert.equal(metrics.signups, 1);
  assert.equal(metrics.retention[0].retained, 1);
  assert.equal(metrics.retention[0].eligible, 1);
});

test('weekly progressing riders counts distinct riders per rolling week, oldest first', () => {
  const actions = [
    action('a', daysAgo(1)),
    action('a', daysAgo(2)),
    action('b', daysAgo(3)),
    action('c', daysAgo(9)),
    action('bot', daysAgo(1)),
  ];
  const metrics = computeWeeklyProgressingRiders({
    actions,
    now: NOW,
    weeks: 3,
    excluded: new Set(['bot']),
  });
  assert.equal(metrics.weeks, 3);
  assert.equal(metrics.series.length, 3);
  assert.deepEqual(
    metrics.series.map((w) => w.progressingRiders),
    [0, 1, 2],
  );
  assert.equal(metrics.current.progressingRiders, 2);
  assert.equal(metrics.current.actions, 3);
  assert.equal(metrics.current.depth, 1.5);
  assert.equal(metrics.series[2].weekEnd, new Date(NOW).toISOString());
});

test('an empty week yields zero depth rather than NaN', () => {
  const metrics = computeWeeklyProgressingRiders({ actions: [], now: NOW, weeks: 1 });
  assert.equal(metrics.current.progressingRiders, 0);
  assert.equal(metrics.current.depth, 0);
});

test('excluded summary labels staff, bots and flagged accounts', () => {
  assert.deepEqual(
    excludedSummary([
      { role: 'admin' },
      { isBot: true },
      { analyticsExcluded: true },
      { role: 'admin', isBot: true },
    ]),
    { admins: 2, bots: 1, flagged: 1 },
  );
});
