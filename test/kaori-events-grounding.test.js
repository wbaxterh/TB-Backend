const assert = require('node:assert/strict');
const { test } = require('node:test');
const { shouldForceEventSearch } = require('../kaori-ai-response');
const { eventDateRange, searchEvents } = require('../kaori-tools');

test('event questions force the live TrickBook calendar tool', () => {
  assert.equal(
    shouldForceEventSearch([{ role: 'user', content: 'what events should I go to this weekend?' }]),
    true,
  );
  assert.equal(
    shouldForceEventSearch([{ role: 'user', content: 'how do I land a kickflip?' }]),
    false,
  );
});

test('weekend searches end after the upcoming Sunday', () => {
  const { start, end } = eventDateRange('weekend', new Date('2026-09-30T18:00:00.000Z'));
  assert.equal(start.toISOString(), '2026-09-30T18:00:00.000Z');
  assert.equal(end.toISOString(), '2026-10-05T00:00:00.000Z');
});

test('event results expose canonical TrickBook links', async () => {
  const docs = [
    {
      _id: { toString: () => 'event-1' },
      slug: 'weekend-jam',
      title: 'Weekend Jam',
      startAt: new Date('2026-10-03T17:00:00.000Z'),
      sports: ['skateboarding'],
      venue: { name: 'The Park', city: 'San Diego', region: 'CA', country: 'US' },
      participation: { registrationStatus: 'open' },
    },
  ];
  const db = {
    collection: () => ({
      find: () => ({
        sort: () => ({
          limit: () => ({ toArray: async () => docs }),
        }),
      }),
    }),
  };

  const result = await searchEvents({ date_range: 'weekend', city: 'San Diego' }, db);
  assert.equal(result.results[0].webUrl, 'https://thetrickbook.com/events/weekend-jam');
  assert.match(result.important, /live TrickBook event calendar/);
});
