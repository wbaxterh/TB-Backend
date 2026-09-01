/**
 * X Games event source.
 *
 * The public WP endpoint /wp-json/xgames/v1/events returns
 *   { content: "<html cards>", current_page, has_next_page, pagination_data }
 * so the events live as HTML inside the JSON — we parse the cards out.
 * No auth/key required.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const {
  slugify,
  cleanText,
  parseDateRange,
  inferSportsFromDate,
  inferDisciplines,
  defaultEventDisciplines,
  dedupeKey,
} = require('./util');

const ENDPOINT = 'https://www.xgames.com/wp-json/xgames/v1/events';
const UA = 'TrickBookEventsBot/1.0 (+https://thetrickbook.com; events@thetrickbook.com)';
const MAX_PAGES = 6;

function parseCards(html) {
  const $ = cheerio.load(html);
  const events = [];

  $('article.xgames-event-card').each((_i, el) => {
    const card = $(el);
    const title = cleanText(card.find('.xgames-event-card-content-title').first().text());
    if (!title) return;

    const dateRange = cleanText(card.find('.xgames-event-card-content-date-range').first().text());
    const image = card.find('.xgames-event-card-image img').first().attr('src') || '';

    let detailsUrl = '';
    let resultsUrl = '';
    card.find('.xgames-event-card-content-link a').each((_j, a) => {
      const href = $(a).attr('href') || '';
      if (/\/results\//.test(href)) resultsUrl = href;
      else if (/\/events\//.test(href)) detailsUrl = href;
    });

    const { startAt, endAt } = parseDateRange(dateRange);
    const isPast = (endAt || startAt) && (endAt || startAt) < new Date();
    // Location is embedded in the title, e.g. "New Orleans 2026" -> "New Orleans"
    const location = cleanText(title.replace(/\s*\d{4}\s*$/, ''));
    const slugBase = detailsUrl ? detailsUrl.replace(/\/$/, '').split('/').pop() : slugify(title);

    const sports = inferSportsFromDate(startAt);
    const inferredDisciplines = inferDisciplines(sports, title, card.text());
    events.push({
      source: 'xgames',
      sourceId: `xgames:${slugBase}`,
      sourceUrl: detailsUrl || ENDPOINT,
      slug: slugify(`xg-${slugBase}`),
      title: `X Games ${title}`,
      description: '',
      sports,
      disciplines: inferredDisciplines.length
        ? inferredDisciplines
        : defaultEventDisciplines(sports),
      startAt,
      endAt,
      timezone: null,
      timeTba: true,
      status: isPast ? 'completed' : 'scheduled',
      isOnline: false,
      venue: { name: '', city: location, region: '', country: '', lat: null, lng: null },
      participation: {}, // invitational / pro — no open registration
      spectating: { inPerson: !isPast, ticketUrl: '', streamUrl: '', streamStatus: '' },
      image,
      media: { images: image ? [image] : [], videos: [] },
      socialLinks: [
        {
          platform: 'instagram',
          label: 'X Games on Instagram',
          url: 'https://www.instagram.com/xgames/',
        },
        { platform: 'youtube', label: 'X Games videos', url: 'https://www.youtube.com/@XGames' },
      ],
      organizer: { name: 'X Games', verified: true },
      series: 'X Games',
      resultsUrl,
      dedupeKey: dedupeKey({ title, startAt, city: location }),
    });
  });

  return events;
}

async function fetchXGamesEvents() {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let data;
    try {
      const res = await axios.get(ENDPOINT, {
        params: { page },
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        timeout: 15000,
      });
      data = res.data;
    } catch (err) {
      console.error(`[events:xgames] fetch page ${page} failed:`, err.message);
      break;
    }
    if (!data || typeof data.content !== 'string') break;
    all.push(...parseCards(data.content));
    if (!data.has_next_page) break;
  }
  // Only keep dated, future-ish events (drop anything we couldn't date).
  return all.filter((e) => e.startAt);
}

module.exports = { fetchXGamesEvents, parseCards };
