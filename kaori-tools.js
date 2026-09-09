const { ObjectId, DBRef } = require('mongodb');
const KNOWLEDGE = require('./kaori-knowledge.json');

// Canonical public URLs so every recommendation links back INTO TrickBook
// instead of the open web. Verified against the frontend routes + llms.txt:
//   trick  -> /trickipedia/<category-lowercased>/<url-slug>
//   film   -> /media/couch/<slug>
const WEB_BASE = 'https://thetrickbook.com';
const trickUrl = (t) =>
  t?.url ? `${WEB_BASE}/trickipedia/${(t.category || '').toLowerCase()}/${t.url}` : null;
const filmUrl = (f) => (f?.slug ? `${WEB_BASE}/media/couch/${f.slug}` : null);

// ============================================
// TOOL DEFINITIONS (OpenAI-compatible format)
// ============================================

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_spots',
      description:
        "Search for skateparks, snowboard resorts, surf breaks, and other action sport spots in TrickBook's database. Use when a user asks about places to ride.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name or keyword to search for' },
          state: { type: 'string', description: 'US state abbreviation (e.g. "CA", "CO")' },
          city: { type: 'string', description: 'City name' },
          sport: {
            type: 'string',
            enum: ['skateboarding', 'snowboarding', 'skiing', 'bmx', 'surfing', 'wakeboarding'],
            description: 'Sport type to filter by',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_trickipedia',
      description:
        'Search the trick encyclopedia for tutorials, descriptions, and steps. Use when a user asks how to do a trick or wants to discover tricks.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Trick name or keyword' },
          category: { type: 'string', description: 'Trick category (e.g. "flatground", "rail")' },
          difficulty: { type: 'string', description: 'Difficulty level' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_films',
      description:
        "Search TrickBook's film catalog (full snowboard/skate/surf videos, edits, and parts). Use when a user asks what to watch, wants film recommendations, or asks about a rider's parts or a specific movie. ALWAYS prefer these over recommending videos from the open web.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Title, rider name, or producer/filmmaker to search for',
          },
          sport: {
            type: 'string',
            enum: ['snowboarding', 'skateboarding', 'skiing', 'bmx', 'surfing', 'wakeboarding'],
            description: 'Sport type to filter by',
          },
          year: { type: 'number', description: 'Release year to filter by' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recommend_next_trick',
      description:
        "Recommend what trick the user should learn next, using TrickBook's trick-progression graph (prerequisites/next-steps) and the tricks they've already landed. Use when a user asks 'what should I learn next', 'what's after X', or wants a personalized suggestion. This is smarter than a generic guess because it walks the actual relationships in TrickBook's data.",
      parameters: {
        type: 'object',
        properties: {
          trick_name: {
            type: 'string',
            description:
              'Optional: base the recommendation on progressing FROM this specific trick. If omitted, uses the tricks the user has already completed.',
          },
          sport: {
            type: 'string',
            description: 'Optional sport/category hint (e.g. "snowboarding", "flatground")',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_tricklists',
      description:
        "Get the user's trick lists and progress. Use when they ask about their lists or what tricks they're working on.",
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_tricklist',
      description:
        'Create a new trick list for the user. Use when they want to start tracking new tricks.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Name for the new trick list' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_trick_to_list',
      description: "Add a trick to one of the user's trick lists.",
      parameters: {
        type: 'object',
        properties: {
          trick_name: { type: 'string', description: 'Name of the trick to add' },
          list_id: { type: 'string', description: 'ID of the trick list to add to' },
        },
        required: ['trick_name', 'list_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_trick_status',
      description:
        'Mark a trick as complete or reset to to-do. Use when the user says they landed a trick.',
      parameters: {
        type: 'object',
        properties: {
          trick_id: { type: 'string', description: 'ID of the trick to update' },
          status: {
            type: 'string',
            enum: ['Complete', 'To Do'],
            description: 'New status',
          },
        },
        required: ['trick_id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_boardsport_knowledge',
      description:
        'Look up boardsport culture info: magazines, Instagram accounts, events/competitions, key figures, and brands. Use when the user asks about the scene, media, or events.',
      parameters: {
        type: 'object',
        properties: {
          sport: {
            type: 'string',
            enum: ['snowboarding', 'skateboarding', 'surfing', 'bmx', 'skiing'],
            description: 'Which sport',
          },
          topic: {
            type: 'string',
            enum: ['magazines', 'instagram', 'events', 'culture', 'all'],
            description: 'What aspect to look up',
          },
        },
        required: ['sport'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember_user_info',
      description:
        'Save information about the user for future sessions. ALWAYS call this when a user tells you their name, what sports they do, or notable facts about themselves. This persists across sessions so you can greet them personally next time.',
      parameters: {
        type: 'object',
        properties: {
          user_name: { type: 'string', description: "The user's name (first name or nickname)" },
          sports: {
            type: 'array',
            items: { type: 'string' },
            description: 'Sports the user does (e.g. ["skateboarding", "snowboarding"])',
          },
          fact: { type: 'string', description: 'A notable fact about the user to remember' },
        },
      },
    },
  },
];

// ============================================
// TOOL HANDLERS
// ============================================

async function searchSpots(args, db) {
  try {
    const query = { approvalStatus: 'approved' };

    if (args.query) {
      query.name = { $regex: args.query, $options: 'i' };
    }
    if (args.state) {
      query.state = { $regex: `^${args.state}$`, $options: 'i' };
    }
    if (args.city) {
      query.city = { $regex: args.city, $options: 'i' };
    }
    if (args.sport) {
      query.sportTypes = args.sport;
    }

    const spots = await db.collection('spots').find(query).sort({ rating: -1 }).limit(5).toArray();

    if (spots.length === 0) {
      return {
        results: [],
        message:
          'No spots found in the TrickBook database for this search. Tell the user there are no spots listed in TrickBook for this yet. You MAY suggest spots from your own knowledge but you MUST clearly say "these aren\'t listed in TrickBook yet but from what I know..." and suggest they add them to the app.',
      };
    }

    return {
      results: spots.map((s) => ({
        id: s._id.toString(),
        name: s.name,
        city: s.city || '',
        state: s.state || '',
        country: s.country || '',
        category: s.category || '',
        sportTypes: s.sportTypes || [],
        rating: s.rating || 0,
        description: s.description ? s.description.substring(0, 150) : '',
      })),
      total: spots.length,
      important:
        'These are from the TrickBook database. Present them as TrickBook spots. If the user asks about spots NOT in these results, you may suggest from your own knowledge but clearly say they are not listed in TrickBook yet.',
    };
  } catch (err) {
    console.error('Tool search_spots error:', err.message);
    return { error: 'Could not search spots right now' };
  }
}

// Pull the curated, still-live tutorials TrickBook has vetted for a trick.
// Prefers the structured tutorials[] (featured/professional-verified) and
// falls back to legacy videos[]/videoUrl. Returns TrickBook-curated links so
// Kaori never has to reach for a random YouTube result (which risks surfacing
// banned content).
function curatedTutorials(t) {
  const out = [];
  for (const tut of t.tutorials || []) {
    if (tut.availability && tut.availability !== 'active') continue;
    if (!tut.canonicalUrl) continue;
    out.push({
      title: tut.title || tut.instructor?.name || tut.platform || 'Tutorial',
      platform: tut.platform || '',
      url: tut.canonicalUrl,
      featured: tut.featured === true,
      professional: tut.instructor?.isProfessional === true,
    });
  }
  for (const v of t.videos || []) {
    const url = typeof v === 'string' ? v : v?.url || v?.canonicalUrl;
    if (url) out.push({ title: v?.title || 'Video', platform: v?.platform || '', url });
  }
  if (out.length === 0 && t.videoUrl) out.push({ title: 'Video', platform: '', url: t.videoUrl });
  // Featured first, cap so results stay compact.
  return out.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)).slice(0, 4);
}

// Resolve a progression edge list ([{trickId,...}]) into names + deep links.
async function resolveProgression(db, edges) {
  const ids = (edges || [])
    .map((e) => e.trickId)
    .filter((id) => id && ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (ids.length === 0) return [];
  const docs = await db
    .collection('trickipedia')
    .find({ _id: { $in: ids } })
    .project({ name: 1, url: 1, category: 1, difficulty: 1 })
    .toArray();
  const byId = {};
  for (const d of docs) byId[d._id.toString()] = d;
  return (edges || [])
    .map((e) => {
      const d = e.trickId && byId[e.trickId.toString()];
      if (!d) return null;
      return {
        name: d.name,
        difficulty: d.difficulty || '',
        strength: e.strength || undefined,
        url: trickUrl(d),
      };
    })
    .filter(Boolean);
}

async function searchTrickipedia(args, db) {
  try {
    const query = {};

    if (args.category) query.category = args.category;
    if (args.difficulty) query.difficulty = args.difficulty;
    if (args.search) {
      // Match name, description, AND aliases so "back one" / "backspin" still
      // find "Backside 180". Aliases are a real field on the trick docs.
      query.$or = [
        { name: { $regex: args.search, $options: 'i' } },
        { aliases: { $regex: args.search, $options: 'i' } },
        { description: { $regex: args.search, $options: 'i' } },
      ];
    }

    const tricks = await db
      .collection('trickipedia')
      .find(query)
      .sort({ name: 1 })
      .limit(5)
      .toArray();

    if (tricks.length === 0) {
      return { results: [], message: 'No tricks found matching that search' };
    }

    const results = [];
    for (const t of tricks) {
      const [prerequisites, nextSteps] = await Promise.all([
        resolveProgression(db, t.progression?.prerequisites),
        resolveProgression(db, t.progression?.nextSteps),
      ]);
      results.push({
        id: t._id.toString(),
        name: t.name,
        aliases: (t.aliases || []).slice(0, 4),
        category: t.category || '',
        difficulty: t.difficulty || '',
        description: t.description ? t.description.substring(0, 200) : '',
        steps: t.steps ? t.steps.slice(0, 3) : [],
        tutorials: curatedTutorials(t),
        prerequisites,
        nextSteps,
        webUrl: trickUrl(t),
      });
    }

    return {
      results,
      total: tricks.length,
      important:
        "These tricks, tutorials, and prerequisite/next-step links are from TrickBook's own database. Recommend the curated tutorials here (with their links) and the trickipedia webUrl — do NOT suggest random tutorials from the open web.",
    };
  } catch (err) {
    console.error('Tool search_trickipedia error:', err.message);
    return { error: 'Could not search tricks right now' };
  }
}

async function searchFilms(args, db) {
  try {
    const query = { isPublished: true, type: 'film' };
    if (args.sport) query.sportTypes = args.sport;
    if (args.year) query.releaseYear = parseInt(args.year, 10);
    if (args.query) {
      const escaped = String(args.query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
        { producedBy: { $regex: escaped, $options: 'i' } },
        { riders: { $regex: escaped, $options: 'i' } },
      ];
    }

    const films = await db
      .collection('couch_videos')
      .find(query, { projection: { bunnyVideoId: 0, hlsUrl: 0, driveFileId: 0 } })
      .sort({ releaseYear: -1, title: 1 })
      .limit(5)
      .toArray();

    if (films.length === 0) {
      return {
        results: [],
        message:
          'No films in the TrickBook catalog matched that. Tell the user there is nothing in TrickBook for this yet — you MAY mention a film you know but you MUST say "this one isn\'t on TrickBook yet".',
      };
    }

    return {
      results: films.map((f) => ({
        id: f._id.toString(),
        title: f.title,
        producedBy: f.producedBy || '',
        riders: (f.riders || []).slice(0, 6),
        releaseYear: f.releaseYear || '',
        sportTypes: f.sportTypes || [],
        description: f.description ? f.description.substring(0, 180) : '',
        webUrl: filmUrl(f),
      })),
      total: films.length,
      important:
        "These are TrickBook films — recommend them by title and include the webUrl so the user can watch on TrickBook. Don't point them to the open web when there's a match here.",
    };
  } catch (err) {
    console.error('Tool search_films error:', err.message);
    return { error: 'Could not search films right now' };
  }
}

async function recommendNextTrick(args, db, senderId) {
  try {
    // Path A: progress FROM a named trick — walk its next-step edges.
    if (args.trick_name) {
      const base = await db.collection('trickipedia').findOne({
        $or: [
          { name: { $regex: `^${args.trick_name}$`, $options: 'i' } },
          { aliases: { $regex: `^${args.trick_name}$`, $options: 'i' } },
        ],
      });
      if (base) {
        const nextSteps = await resolveProgression(db, base.progression?.nextSteps);
        if (nextSteps.length > 0) {
          return {
            basis: `next steps after ${base.name}`,
            recommendations: nextSteps.slice(0, 4),
            source: 'trickbook_progression_graph',
          };
        }
      }
    }

    // Path B: personalized — use the tricks the user has already landed.
    const completedNames = new Set();
    if (senderId) {
      const lists = await db
        .collection('tricklists')
        .find({ 'user.$id': senderId })
        .project({ tricks: 1 })
        .toArray();
      const trickIds = lists
        .flatMap((tl) => (tl.tricks || []).map((t) => t._id))
        .filter(Boolean);
      if (trickIds.length > 0) {
        const userTricks = await db
          .collection('tricks')
          .find({ _id: { $in: trickIds } })
          .project({ name: 1, checked: 1 })
          .toArray();
        for (const t of userTricks) {
          if ((t.checked === 'Complete' || t.checked === true) && t.name) {
            completedNames.add(t.name.toLowerCase());
          }
        }
      }
    }

    if (completedNames.size > 0) {
      // Find trickipedia entries matching completed tricks, gather their nextSteps,
      // and drop anything the user already has.
      const landed = await db
        .collection('trickipedia')
        .find({
          $or: [...completedNames].map((n) => ({
            name: { $regex: `^${n}$`, $options: 'i' },
          })),
        })
        .project({ name: 1, progression: 1 })
        .toArray();
      const edges = landed.flatMap((t) => t.progression?.nextSteps || []);
      const resolved = await resolveProgression(db, edges);
      const seen = new Set();
      const recs = resolved.filter((r) => {
        const key = r.name.toLowerCase();
        if (completedNames.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (recs.length > 0) {
        return {
          basis: `based on ${landed.length} trick(s) you've landed`,
          recommendations: recs.slice(0, 5),
          source: 'trickbook_progression_graph',
        };
      }
    }

    // Path C: cold start — suggest beginner-friendly tricks from the catalog.
    const beginnerQuery = { difficulty: { $regex: 'beginner|easy|1', $options: 'i' } };
    if (args.sport) beginnerQuery.category = { $regex: args.sport, $options: 'i' };
    const starters = await db
      .collection('trickipedia')
      .find(beginnerQuery)
      .project({ name: 1, url: 1, category: 1, difficulty: 1 })
      .limit(5)
      .toArray();
    return {
      basis: 'starter tricks (no landed tricks on record yet)',
      recommendations: starters.map((t) => ({
        name: t.name,
        difficulty: t.difficulty || '',
        url: trickUrl(t),
      })),
      source: 'trickbook_catalog',
      note:
        starters.length === 0
          ? "Nothing matched — ask the user what they can already do so you can use TrickBook's progression graph next time."
          : undefined,
    };
  } catch (err) {
    console.error('Tool recommend_next_trick error:', err.message);
    return { error: 'Could not build a recommendation right now' };
  }
}

async function getUserTricklists(db, senderId) {
  try {
    const trickLists = await db.collection('tricklists').find({ 'user.$id': senderId }).toArray();

    if (trickLists.length === 0) {
      return { lists: [], message: "User doesn't have any trick lists yet" };
    }

    // Get all trick IDs across all lists
    const trickIds = trickLists.flatMap((tl) => tl.tricks.map((t) => t._id));
    const tricks = await db
      .collection('tricks')
      .find({ _id: { $in: trickIds } })
      .toArray();

    const trickMap = {};
    for (const t of tricks) {
      trickMap[t._id.toString()] = t;
    }

    const allLists = trickLists.map((tl) => {
      const resolvedTricks = tl.tricks.map((t) => {
        const found = t._id ? trickMap[t._id.toString()] : null;
        return {
          id: t._id?.toString() || '',
          name: found?.name || t.name || 'Unknown',
          status: found?.checked || t.checked || 'To Do',
        };
      });
      const completed = resolvedTricks.filter(
        (t) => t.status === 'Complete' || t.status === true,
      ).length;
      return {
        id: tl._id.toString(),
        name: tl.name,
        totalTricks: resolvedTricks.length,
        completed,
        tricks: resolvedTricks.slice(0, 5),
      };
    });

    // Return last 3 + total count — guide the model to be concise
    const recentLists = allLists.slice(-3);
    return {
      totalListCount: allLists.length,
      recentLists,
      responseGuide: `Tell the user: "You have ${allLists.length} trick lists total! Your last 3 are: [names of the 3 lists]. Which one are you looking for?" Do NOT list all ${allLists.length} lists. Keep it short.`,
    };
  } catch (err) {
    console.error('Tool get_user_tricklists error:', err.message);
    return { error: 'Could not fetch trick lists right now' };
  }
}

async function createTricklist(args, db, senderId) {
  try {
    const listing = {
      name: args.title,
      user: new DBRef('users', senderId),
      completed: 0,
      tricks: [],
      isPublic: true,
      createdAt: new Date(),
      createdBy: 'kaori',
    };

    const result = await db.collection('tricklists').insertOne(listing);

    return {
      success: true,
      listId: result.insertedId.toString(),
      name: args.title,
      message: `Created trick list "${args.title}"`,
    };
  } catch (err) {
    console.error('Tool create_tricklist error:', err.message);
    return { error: 'Could not create trick list right now' };
  }
}

async function addTrickToList(args, db, senderId) {
  try {
    if (!ObjectId.isValid(args.list_id)) {
      return { error: 'Invalid list ID' };
    }

    // Verify the list exists AND belongs to this user
    const list = await db.collection('tricklists').findOne({ _id: new ObjectId(args.list_id) });
    if (!list) {
      return { error: 'Trick list not found' };
    }
    if (list.user?.$id && list.user.$id.toString() !== senderId) {
      return { error: 'You can only add tricks to your own lists' };
    }

    // Insert the trick
    const trickDoc = {
      name: args.trick_name,
      list_id: args.list_id,
      checked: 'To Do',
      createdAt: new Date(),
      createdBy: 'kaori',
    };

    const insertResult = await db.collection('tricks').insertOne(trickDoc);
    const trickId = insertResult.insertedId;

    // Push trick reference to the list
    await db
      .collection('tricklists')
      .findOneAndUpdate(
        { _id: new ObjectId(args.list_id) },
        { $push: { tricks: { _id: new ObjectId(trickId) } } },
      );

    return {
      success: true,
      trickId: trickId.toString(),
      trickName: args.trick_name,
      listName: list.name,
      message: `Added "${args.trick_name}" to "${list.name}"`,
    };
  } catch (err) {
    console.error('Tool add_trick_to_list error:', err.message);
    return { error: 'Could not add trick to list right now' };
  }
}

async function updateTrickStatus(args, db, senderId) {
  try {
    if (!ObjectId.isValid(args.trick_id)) {
      return { error: 'Invalid trick ID' };
    }

    // Verify trick exists and belongs to a list the user owns
    const existingTrick = await db
      .collection('tricks')
      .findOne({ _id: new ObjectId(args.trick_id) });
    if (!existingTrick) {
      return { error: 'Trick not found' };
    }
    if (existingTrick.list_id) {
      const list = await db
        .collection('tricklists')
        .findOne({ _id: new ObjectId(existingTrick.list_id) });
      if (list?.user?.$id && list.user.$id.toString() !== senderId) {
        return { error: 'You can only update tricks in your own lists' };
      }
    }

    await db
      .collection('tricks')
      .findOneAndUpdate(
        { _id: new ObjectId(args.trick_id) },
        { $set: { checked: args.status, updatedAt: new Date() } },
      );
    return {
      success: true,
      trickId: args.trick_id,
      trickName: existingTrick.name || 'Unknown',
      newStatus: args.status,
      message: `Marked "${existingTrick.name || 'trick'}" as ${args.status}`,
    };
  } catch (err) {
    console.error('Tool update_trick_status error:', err.message);
    return { error: 'Could not update trick status right now' };
  }
}

function lookupBoardsportKnowledge(args) {
  const sport = args.sport;
  const topic = args.topic || 'all';

  if (!KNOWLEDGE[sport]) {
    return { error: `No knowledge available for "${sport}"` };
  }

  if (topic === 'all') {
    return KNOWLEDGE[sport];
  }

  if (!KNOWLEDGE[sport][topic]) {
    return { error: `No "${topic}" info available for ${sport}` };
  }

  return { sport, topic, data: KNOWLEDGE[sport][topic] };
}

async function rememberUserInfo(args, db, senderId) {
  try {
    const kaoriBotId = '69c15e55c7ebe2c6884f1267';
    const update = {};

    if (args.user_name) {
      update['memory.userName'] = args.user_name;
    }
    if (args.sports && args.sports.length > 0) {
      update['traits.sports'] = args.sports;
    }

    const operations = { $set: update };

    if (args.fact) {
      operations.$addToSet = { 'memory.knownFacts': args.fact };
    }

    if (Object.keys(update).length === 0 && !args.fact) {
      return { error: 'Nothing to remember — provide a name, sports, or fact' };
    }

    await db
      .collection('companion_profiles')
      .updateOne({ userId: senderId, companionId: kaoriBotId }, operations, { upsert: true });

    const saved = [];
    if (args.user_name) saved.push(`name: ${args.user_name}`);
    if (args.sports?.length) saved.push(`sports: ${args.sports.join(', ')}`);
    if (args.fact) saved.push(`fact: ${args.fact}`);

    console.log(`[Kaori] Remembered for user ${senderId}: ${saved.join(', ')}`);
    return { success: true, saved, message: `Remembered: ${saved.join(', ')}` };
  } catch (err) {
    console.error('Tool remember_user_info error:', err.message);
    return { error: 'Could not save user info right now' };
  }
}

// ============================================
// DISPATCHER
// ============================================

async function executeToolCall(toolName, args, db, senderId) {
  switch (toolName) {
    case 'search_spots':
      return await searchSpots(args, db);
    case 'search_trickipedia':
      return await searchTrickipedia(args, db);
    case 'search_films':
      return await searchFilms(args, db);
    case 'recommend_next_trick':
      return await recommendNextTrick(args, db, senderId);
    case 'get_user_tricklists':
      return await getUserTricklists(db, senderId);
    case 'create_tricklist':
      return await createTricklist(args, db, senderId);
    case 'add_trick_to_list':
      return await addTrickToList(args, db, senderId);
    case 'update_trick_status':
      return await updateTrickStatus(args, db, senderId);
    case 'lookup_boardsport_knowledge':
      return lookupBoardsportKnowledge(args);
    case 'remember_user_info':
      return await rememberUserInfo(args, db, senderId);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

module.exports = { TOOL_DEFINITIONS, executeToolCall };
