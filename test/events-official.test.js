const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fetchOfficialEvents } = require('../services/events/official');

test('official calendars add categorized events and useful external links', async () => {
  const events = await fetchOfficialEvents();
  assert.equal(events.length, 6);
  assert.ok(events.every((event) => event.startAt instanceof Date));
  assert.ok(events.every((event) => event.disciplines.length > 0));
  assert.ok(events.every((event) => event.externalLinks[0].url === event.sourceUrl));
  assert.ok(events.some((event) => event.participation.registrationStatus === 'open'));
  assert.ok(events.some((event) => event.media.videos.length > 0));
});
