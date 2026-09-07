/**
 * The Boardr event source (skate contests + results). robots.txt = Allow: /.
 *
 * theboardr.com/events is a large emotion/CSS-in-JS rendered page; extracting
 * individual contests reliably needs selectors tuned against its live markup,
 * which is a dedicated pass. This scaffold fetches politely and returns [] until
 * the per-event parser is implemented, so ingestion runs cleanly on X Games
 * alone in the meantime. Implemented as a best-effort no-op — never throws.
 */
const axios = require('axios');

const UA = 'TrickBookEventsBot/1.0 (+https://thetrickbook.com; events@thetrickbook.com)';
const EVENTS_URL = 'https://www.theboardr.com/events';

// TODO(events): parse per-contest cards (name, date, city, series, results URL)
// from the live markup and normalize to the shared event shape.
async function fetchBoardrEvents() {
  try {
    // Polite fetch (identified UA, timeout) — reserved for the real parser.
    await axios.get(EVENTS_URL, { headers: { 'User-Agent': UA }, timeout: 15000 });
  } catch (err) {
    console.error('[events:boardr] fetch failed:', err.message);
  }
  return [];
}

module.exports = { fetchBoardrEvents };
