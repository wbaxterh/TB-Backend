/**
 * Companion Relationship Profile API
 *
 * Per-user profile that tracks how Kaori (or any bot companion) should
 * interact with a specific user. Evolves over time based on interactions.
 *
 * Schema:
 *   userId           - the human user
 *   companionId      - the bot user ID
 *   relationshipStage - stranger | acquaintance | friend | close_friend | bestie
 *   interactionCount - total messages exchanged
 *   traits           - learned preferences about the user
 *   memory           - key facts Kaori remembers
 *   greetingStyle    - how Kaori greets this user
 *   firstInteraction - when they first talked
 *   lastInteraction  - last message timestamp
 */

const express = require('express');
const axios = require('axios');
const { ObjectId } = require('mongodb');
const auth = require('../middleware/auth');

const _STAGES = ['stranger', 'acquaintance', 'friend', 'close_friend', 'bestie'];

function computeStage(interactionCount) {
  if (interactionCount < 5) return 'stranger';
  if (interactionCount < 20) return 'acquaintance';
  if (interactionCount < 60) return 'friend';
  if (interactionCount < 150) return 'close_friend';
  return 'bestie';
}

// `fallbackName` is the user's account first name — used when the user hasn't
// told Kaori a different name to call them yet (memory.userName overrides it).
function generateGreeting(profile, fallbackName = '') {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const stage = profile.relationshipStage || 'stranger';
  const name = profile.memory?.userName || fallbackName || '';
  const lastInteraction = profile.lastInteraction ? new Date(profile.lastInteraction) : null;
  const daysSinceLastVisit = lastInteraction
    ? Math.floor((Date.now() - lastInteraction.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Homie / dry-rider register (matches KAORI_SYSTEM_PROMPT) — short, chill,
  // name-aware, emoji almost never. Warmth scales up with relationship stage
  // but never turns into cheerleader energy.
  const greetings = {
    stranger: {
      morning: [
        `yo. mornin. I'm Kaori — what do you ride?`,
        `ayy, new face. I'm Kaori. skate or snow?`,
      ],
      afternoon: [`yo, what's up? I'm Kaori.`, `sup. Kaori. what do you ride?`],
      evening: [
        `yo. late one. I'm Kaori — what do you ride?`,
        `ayy, evening. Kaori here. skate or snow?`,
      ],
    },
    acquaintance: {
      morning: [
        `yo${name ? ` ${name}` : ''}. mornin.`,
        `mornin${name ? ` ${name}` : ''}. what's the plan?`,
      ],
      afternoon: [
        `yo${name ? ` ${name}` : ''}. what's up?`,
        `sup${name ? ` ${name}` : ''}. what're we working on?`,
      ],
      evening: [
        `yo${name ? ` ${name}` : ''}. how'd it go today?`,
        `ayy${name ? ` ${name}` : ''}. evening.`,
      ],
    },
    friend: {
      morning: [
        `yo ${name || 'homie'}. back at it. what's up?`,
        `mornin ${name || 'dude'}. what're we hitting today?`,
      ],
      afternoon: [
        `ayy ${name || 'homie'}. good to see you. what's good?`,
        `yo ${name || 'dude'}. what's the mission today?`,
      ],
      evening: [
        `yo ${name || 'homie'}. how was the day?`,
        `ayy ${name || 'dude'}${daysSinceLastVisit > 2 ? `, been a minute` : ''}. what's up?`,
      ],
    },
    close_friend: {
      morning: [
        `yo ${name || 'homie'}. mornin. what're we working on?`,
        `ayy ${name || 'dude'}${daysSinceLastVisit > 2 ? `, where you been` : ''}. what's good?`,
      ],
      afternoon: [
        `yo ${name || 'homie'}. what's good?`,
        `${name || 'ayy'}. glad you're on. what's the plan?`,
      ],
      evening: [
        `yo ${name || 'homie'}. how'd today go?`,
        `ayy ${name || 'dude'}. late sesh? what's up?`,
      ],
    },
    bestie: {
      morning: [
        `yo ${name || 'homie'}. knew you'd show. what're we working on?`,
        `mornin ${name || 'dude'}. let's get after it — what's up?`,
      ],
      afternoon: [
        `ayy ${name || 'homie'}${daysSinceLastVisit > 1 ? `, finally` : ''}. what's good?`,
        `yo ${name || 'dude'}. good to see you on. what's the plan?`,
      ],
      evening: [
        `yo ${name || 'homie'}. how was it today?`,
        `ayy ${name || 'dude'}. late one — what's up?`,
      ],
    },
  };

  const stageGreetings = greetings[stage] || greetings.stranger;
  const timeGreetings = stageGreetings[timeOfDay] || stageGreetings.afternoon;
  const greeting = timeGreetings[Math.floor(Math.random() * timeGreetings.length)];

  // Add context about last trick if we remember one
  const lastTrick = profile.memory?.lastTrickDiscussed;
  if (lastTrick && stage !== 'stranger' && Math.random() > 0.5) {
    return `${greeting} you get that ${lastTrick} yet?`;
  }

  return greeting;
}

function createRouter(db) {
  const router = express.Router();
  const profilesCollection = db.collection('companion_profiles');

  // Ensure index
  profilesCollection.createIndex({ userId: 1, companionId: 1 }, { unique: true }).catch(() => {});

  // GET /api/companion/profile/:companionId — get or create relationship profile
  router.get('/profile/:companionId', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { companionId } = req.params;

      let profile = await profilesCollection.findOne({ userId, companionId });

      if (!profile) {
        profile = {
          userId,
          companionId,
          relationshipStage: 'stranger',
          interactionCount: 0,
          traits: {
            preferredTopics: [],
            communicationStyle: 'casual',
            humorLevel: 'medium',
            emotionalOpenness: 'medium',
            sports: [],
          },
          memory: {
            userName: '',
            knownFacts: [],
            lastTrickDiscussed: '',
            lastSessionMood: 'neutral',
          },
          greetingStyle: 'default',
          firstInteraction: null,
          lastInteraction: null,
          createdAt: new Date(),
        };

        await profilesCollection.insertOne(profile);
      }

      res.json(profile);
    } catch (error) {
      console.error('Error fetching companion profile:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  // POST /api/companion/profile/:companionId/greeting — generate a greeting
  router.post('/profile/:companionId/greeting', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { companionId } = req.params;

      let profile = await profilesCollection.findOne({ userId, companionId });

      if (!profile) {
        profile = {
          userId,
          companionId,
          relationshipStage: 'stranger',
          interactionCount: 0,
          traits: {},
          memory: {},
        };
      }

      // Default the name Kaori uses to the user's account first name, unless
      // they've told her to call them something else (memory.userName wins).
      let fallbackName = '';
      try {
        if (ObjectId.isValid(userId)) {
          const account = await db
            .collection('users')
            .findOne({ _id: new ObjectId(userId) }, { projection: { name: 1 } });
          fallbackName = (account?.name || '').trim().split(/\s+/)[0] || '';
        }
      } catch (_e) {
        /* name lookup is best-effort */
      }

      const greeting = generateGreeting(profile, fallbackName);

      res.json({ greeting, stage: profile.relationshipStage });

      // If this came from the live 3D stage (x-kith-session header), speak the
      // greeting aloud via the Kith sidecar. Fire-and-forget AFTER the response
      // — same pattern as botChat replies; must never throw (headers sent).
      const kithSessionId = req.headers['x-kith-session'] || '';
      const isValidKithSession = /^[0-9a-f-]{36}$/i.test(kithSessionId);
      if (isValidKithSession && process.env.KITH_VOICE_URL) {
        const base = process.env.KITH_VOICE_URL.replace(/\/$/, '');
        axios
          .post(`${base}/speak/${kithSessionId}`, { text: greeting }, { timeout: 5000 })
          .catch((e) => console.error('[Companion] Kith greeting speak error:', e.message));
      }
      return;
    } catch (error) {
      console.error('Error generating greeting:', error);
      res.status(500).json({ error: 'Failed to generate greeting' });
    }
  });

  // PUT /api/companion/profile/:companionId — update profile fields
  router.put('/profile/:companionId', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { companionId } = req.params;
      const updates = req.body;

      // Only allow updating specific fields
      const allowed = {};
      if (updates.memory) allowed['memory'] = updates.memory;
      if (updates.traits) allowed['traits'] = updates.traits;
      if (updates.greetingStyle) allowed['greetingStyle'] = updates.greetingStyle;

      if (Object.keys(allowed).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const result = await profilesCollection.findOneAndUpdate(
        { userId, companionId },
        { $set: allowed },
        { returnDocument: 'after', upsert: true },
      );

      res.json(result.value || result);
    } catch (error) {
      console.error('Error updating companion profile:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  return router;
}

// Export both the factory function and helper functions for use in dm.js / kaori-ai-response.js
module.exports = createRouter;
module.exports.computeStage = computeStage;
module.exports.generateGreeting = generateGreeting;
