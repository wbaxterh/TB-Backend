const { ObjectId, DBRef } = require('mongodb');
const KNOWLEDGE = require('./kaori-knowledge.json');

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
      return { results: [], message: 'No spots found matching that search' };
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
    };
  } catch (err) {
    console.error('Tool search_spots error:', err.message);
    return { error: 'Could not search spots right now' };
  }
}

async function searchTrickipedia(args, db) {
  try {
    const query = {};

    if (args.category) query.category = args.category;
    if (args.difficulty) query.difficulty = args.difficulty;
    if (args.search) {
      query.$or = [
        { name: { $regex: args.search, $options: 'i' } },
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

    return {
      results: tricks.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        category: t.category || '',
        difficulty: t.difficulty || '',
        description: t.description ? t.description.substring(0, 200) : '',
        steps: t.steps ? t.steps.slice(0, 3) : [],
      })),
      total: tricks.length,
    };
  } catch (err) {
    console.error('Tool search_trickipedia error:', err.message);
    return { error: 'Could not search tricks right now' };
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

    return {
      lists: trickLists.map((tl) => {
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
          tricks: resolvedTricks.slice(0, 10), // Limit to avoid huge payloads
        };
      }),
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
      isPublic: false,
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

async function addTrickToList(args, db) {
  try {
    if (!ObjectId.isValid(args.list_id)) {
      return { error: 'Invalid list ID' };
    }

    // Verify the list exists
    const list = await db.collection('tricklists').findOne({ _id: new ObjectId(args.list_id) });
    if (!list) {
      return { error: 'Trick list not found' };
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

async function updateTrickStatus(args, db) {
  try {
    if (!ObjectId.isValid(args.trick_id)) {
      return { error: 'Invalid trick ID' };
    }

    const result = await db
      .collection('tricks')
      .findOneAndUpdate(
        { _id: new ObjectId(args.trick_id) },
        { $set: { checked: args.status, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );

    if (!result.value && !result) {
      return { error: 'Trick not found' };
    }

    const trick = result.value || result;
    return {
      success: true,
      trickId: args.trick_id,
      trickName: trick.name || 'Unknown',
      newStatus: args.status,
      message: `Marked "${trick.name || 'trick'}" as ${args.status}`,
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

// ============================================
// DISPATCHER
// ============================================

async function executeToolCall(toolName, args, db, senderId) {
  switch (toolName) {
    case 'search_spots':
      return await searchSpots(args, db);
    case 'search_trickipedia':
      return await searchTrickipedia(args, db);
    case 'get_user_tricklists':
      return await getUserTricklists(db, senderId);
    case 'create_tricklist':
      return await createTricklist(args, db, senderId);
    case 'add_trick_to_list':
      return await addTrickToList(args, db);
    case 'update_trick_status':
      return await updateTrickStatus(args, db);
    case 'lookup_boardsport_knowledge':
      return lookupBoardsportKnowledge(args);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

module.exports = { TOOL_DEFINITIONS, executeToolCall };
