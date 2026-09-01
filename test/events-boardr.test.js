const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  normalizeBoardrEvent,
  parseBoardrPage,
  splitLocation,
} = require('../services/events/boardr');

const RAW_EVENT = {
  EventID: 4363,
  Title: 'Swampfest Presented by Monster Energy',
  StartDate: '3/11/2027 5:00:00 PM',
  ExpireDate: '3/13/2027 11:30:00 PM',
  ShortDescription: 'A BMX and skateboarding festival in a Florida swamp.',
  Location: 'Waldo, Florida',
};

test('normalizes a Boardr event into the canonical MVP shape', () => {
  const event = normalizeBoardrEvent(RAW_EVENT);
  assert.equal(event.sourceId, 'boardr:4363');
  assert.equal(event.startAt.toISOString(), '2027-03-11T12:00:00.000Z');
  assert.equal(event.endAt.toISOString(), '2027-03-13T12:00:00.000Z');
  assert.deepEqual(event.sports, ['skateboarding', 'bmx']);
  assert.deepEqual(event.eventKinds, ['festival']);
  assert.equal(event.venue.city, 'Waldo');
  assert.equal(event.venue.region, 'Florida');
  assert.equal(event.status, 'scheduled');
});

test('parses the server-rendered Next.js event list', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { eventList: [RAW_EVENT] } },
  })}</script>`;
  const events = parseBoardrPage(html);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, RAW_EVENT.Title);
});

test('fails loudly when the upstream page shape changes', () => {
  assert.throws(() => parseBoardrPage('<html></html>'), /__NEXT_DATA__/);
});

test('keeps compound city names and extracts the final region', () => {
  assert.deepEqual(splitLocation('Irmo and Columbia, South Carolina'), {
    name: '',
    city: 'Irmo and Columbia',
    region: 'South Carolina',
    country: 'USA',
    lat: null,
    lng: null,
  });
});
