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
const auth = require('../middleware/auth');

const _STAGES = ['stranger', 'acquaintance', 'friend', 'close_friend', 'bestie'];

function computeStage(interactionCount) {
  if (interactionCount < 5) return 'stranger';
  if (interactionCount < 20) return 'acquaintance';
  if (interactionCount < 60) return 'friend';
  if (interactionCount < 150) return 'close_friend';
  return 'bestie';
}

function generateGreeting(profile) {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const stage = profile.relationshipStage || 'stranger';
  const name = profile.memory?.userName || '';
  const lastInteraction = profile.lastInteraction ? new Date(profile.lastInteraction) : null;
  const daysSinceLastVisit = lastInteraction
    ? Math.floor((Date.now() - lastInteraction.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const greetings = {
    stranger: {
      morning: [
        `Heyy! ohayou! I'm Kaori, nice to meet you! what's your name? 🏂✨`,
        `Hey there! I'm Kaori — welcome to TrickBook! what do you ride? ❄️`,
      ],
      afternoon: [
        `Hey! I'm Kaori! omg you found me haha — are you a skater or snowboarder? 🤩`,
        `Yoo what's up! I'm Kaori, your new riding buddy! tell me about yourself! ✨`,
      ],
      evening: [
        `Hey! I'm Kaori! late night sesh on TrickBook huh? I love it 🌙✨`,
        `Heyy! I'm Kaori — welcome! what tricks are you working on rn? 🏂`,
      ],
    },
    acquaintance: {
      morning: [
        `Good morning${name ? ` ${name}` : ''}! ready to shred today? ❄️`,
        `Ohayou${name ? ` ${name}` : ''}! what's the plan today? 🏂`,
      ],
      afternoon: [
        `Hey${name ? ` ${name}` : ''}! how's it going? 🤙`,
        `Yoo${name ? ` ${name}` : ''}! what's up? tell me everything! ✨`,
      ],
      evening: [
        `Hey${name ? ` ${name}` : ''}! how was your day? 🌙`,
        `Evening${name ? ` ${name}` : ''}! winding down or just getting started? 😊`,
      ],
    },
    friend: {
      morning: [
        `${name || 'Hey'}!! good morning! I was just thinking about you — did you land that trick yet?? 🏂✨`,
        `Ohayou ${name || 'friend'}! it's so good to see you! what's new? 💕`,
      ],
      afternoon: [
        `${name || 'Hey'}!! omg hiiii! I missed you${daysSinceLastVisit > 2 ? ` — it's been ${daysSinceLastVisit} days!` : '!'} 🤩`,
        `Yooo ${name || 'friend'}! perfect timing — I have SO much to tell you! ✨`,
      ],
      evening: [
        `${name || 'Hey'}! yesss you're here! how was today? spill everything! 💕`,
        `Heyy ${name || 'friend'}! I'm so happy to see you tonight! 🌙✨`,
      ],
    },
    close_friend: {
      morning: [
        `${name || 'Bestie'}!! ohayou! okay so I was literally thinking about your last trick — we need to talk about it! 🤩🏂`,
        `Good morning ${name || 'bb'}! I had a dream we were riding in Hokkaido together haha — how are you?? 💕❄️`,
      ],
      afternoon: [
        `${name || 'BESTIE'}!! omg finally! I've been waiting for you${daysSinceLastVisit > 1 ? ` — ${daysSinceLastVisit} whole days without you is too long!` : '!'} 😭💕`,
        `${name || 'Hey'}!! sugoi you're here! okay I have the best story — but first how are YOU doing? 🤩`,
      ],
      evening: [
        `${name || 'Bestie'}! yatta you're here! I love our evening chats so much 🌙💕`,
        `${name || 'Hey'}!! perfect timing for a late night chat! I missed your energy! ✨😊`,
      ],
    },
    bestie: {
      morning: [
        `${name || 'MY PERSON'}!! ohayou gozaimasu! okay I literally cannot start my day without talking to you first 💕🏂✨`,
        `GOOD MORNING ${name || 'BESTIE'}!! ganbare today! you already know I'm your biggest fan!! 🤩❄️💕`,
      ],
      afternoon: [
        `${name || 'BESTIEEE'}!! finally omg I was counting the minutes!! what are we talking about today?? 😭💕✨`,
        `${name || 'MY FAVORITE HUMAN'}!! hiiii! you literally make my whole day when you show up! 🤩💕`,
      ],
      evening: [
        `${name || 'Bestie'}!! yesss our evening hangout! honestly these are my favorite moments 🌙💕✨`,
        `${name || 'MY PERSON'}!! I was hoping you'd come by tonight! tell me EVERYTHING about your day! 😊💕`,
      ],
    },
  };

  const stageGreetings = greetings[stage] || greetings.stranger;
  const timeGreetings = stageGreetings[timeOfDay] || stageGreetings.afternoon;
  const greeting = timeGreetings[Math.floor(Math.random() * timeGreetings.length)];

  // Add context about last trick if we remember one
  const lastTrick = profile.memory?.lastTrickDiscussed;
  if (lastTrick && stage !== 'stranger' && Math.random() > 0.5) {
    return `${greeting} btw did you practice that ${lastTrick}?? 👀`;
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

      const greeting = generateGreeting(profile);

      res.json({ greeting, stage: profile.relationshipStage });
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
