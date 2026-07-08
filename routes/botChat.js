const express = require('express');
const auth = require('../middleware/auth');
const axios = require('axios');
require('dotenv').config();

module.exports = (db) => {
  const router = express.Router();

  // History reads run on every message send — keep them indexed
  // (fire-and-forget, mirrors routes/companionProfile.js)
  db.collection('bot_chats')
    .createIndex({ fromUserId: 1, toUserId: 1, createdAt: -1 })
    .catch(() => {});
  db.collection('bot_chats')
    .createIndex({ toUserId: 1, fromUserId: 1, createdAt: -1 })
    .catch(() => {});
  db.collection('conversations')
    .createIndex({ participants: 1 })
    .catch(() => {});
  db.collection('dm_messages')
    .createIndex({ conversationId: 1, createdAt: -1 })
    .catch(() => {});

  // GET /api/bot-chat/bots - List all available bots
  router.get('/bots', async (_req, res) => {
    try {
      const bots = await db
        .collection('users')
        .find({
          isBot: true,
        })
        .project({
          _id: 1,
          name: 1,
          bio: 1,
          botCharacter: 1,
          imageUri: 1,
        })
        .toArray();

      res.json(bots);
    } catch (error) {
      console.error('Error fetching bots:', error);
      res.status(500).json({ error: 'Failed to fetch bots' });
    }
  });

  // GET /api/bot-chat/history/:botId - Get chat history with a specific bot
  router.get('/history/:botId', auth, async (req, res) => {
    try {
      const { botId } = req.params;
      const userId = req.user.userId;

      // Verify bot exists
      const bot = await db
        .collection('users')
        .findOne({ _id: new (require('mongodb').ObjectId)(botId), isBot: true });
      if (!bot) {
        return res.status(404).json({ error: 'Bot not found' });
      }

      // Get chat history
      const chatHistory = await db
        .collection('bot_chats')
        .find({
          $or: [
            { fromUserId: userId, toUserId: botId },
            { fromUserId: botId, toUserId: userId },
          ],
        })
        .sort({ createdAt: 1 })
        .toArray();

      res.json(chatHistory);
    } catch (error) {
      console.error('Error fetching chat history:', error);
      res.status(500).json({ error: 'Failed to fetch chat history' });
    }
  });

  // POST /api/bot-chat/message - Send message to bot and get response
  router.post('/message', auth, async (req, res) => {
    try {
      const { botId, message } = req.body;
      const userId = req.user.userId;
      // Kith voice session ID (sent by the mobile Kaori 3D stage) — same
      // contract as the web Kaori Live client (see dm.js).
      const kithSessionId = req.headers['x-kith-session'] || '';

      if (!botId || !message) {
        return res.status(400).json({ error: 'botId and message are required' });
      }

      // Verify bot exists
      const bot = await db
        .collection('users')
        .findOne({ _id: new (require('mongodb').ObjectId)(botId), isBot: true });
      if (!bot) {
        return res.status(404).json({ error: 'Bot not found' });
      }

      // Save user message
      const userMessage = {
        fromUserId: userId,
        toUserId: botId,
        userId: userId,
        message: message,
        type: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const userMessageResult = await db.collection('bot_chats').insertOne(userMessage);
      userMessage._id = userMessageResult.insertedId;

      // Generate the reply. Kaori goes straight to her own brain (the
      // ElizaOS hop always 401s and only added a wasted roundtrip + long
      // timeout); other bot characters keep the Eliza path so they aren't
      // silently rerouted through the Kaori persona + Kaori's history.
      const isKaori = (bot.botCharacter || 'kaori') === 'kaori';
      let botResponse;
      if (!isKaori || process.env.BOTCHAT_USE_ELIZA === 'true') {
        try {
          const elizaResponse = await axios.post(
            'http://localhost:3001/api/chat',
            {
              userId: userId,
              message: message,
              character: bot.botCharacter || 'kaori',
            },
            {
              timeout: 10000,
            },
          );
          botResponse = elizaResponse.data.response;
        } catch (elizaError) {
          console.error('ElizaOS API error:', elizaError.message);
        }
      }
      if (!botResponse && isKaori) {
        try {
          const { generateKaoriResponse } = require('../kaori-ai-response');
          // A kith session means the user is on the live 3D stage — Kaori
          // structures demo replies so her body can act them out.
          botResponse = await generateKaoriResponse(message, db, null, userId, {
            onStage: Boolean(kithSessionId),
          });
        } catch (fallbackErr) {
          console.error('Kaori fallback error:', fallbackErr.message);
        }
      }
      if (!botResponse) {
        botResponse =
          "Hey! I'm having some technical difficulties right now. Can you try again in a moment? 🤖✨";
      }

      // Save bot response
      const botMessage = {
        fromUserId: botId,
        toUserId: userId,
        message: botResponse,
        type: 'bot',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const botMessageResult = await db.collection('bot_chats').insertOne(botMessage);
      botMessage._id = botMessageResult.insertedId;

      // Return both messages
      res.json({
        userMessage,
        botMessage,
      });

      // Fire-and-forget: stream Kaori's reply as voice through the Kith
      // sidecar (mirrors dm.js). Session ids are UUIDs minted by Kith —
      // validate the client-supplied header before putting it in a URL.
      // axios (unlike http.request) also handles https and path-prefixed
      // KITH_VOICE_URL values. Runs after res.json, so it must never throw
      // into the outer catch (headers already sent).
      const isValidKithSession = /^[0-9a-f-]{36}$/i.test(kithSessionId);
      if (isValidKithSession && process.env.KITH_VOICE_URL) {
        const base = process.env.KITH_VOICE_URL.replace(/\/$/, '');
        axios
          .post(`${base}/speak/${kithSessionId}`, { text: botResponse }, { timeout: 5000 })
          .catch((e) => console.error('[BotChat] Kith voice request error:', e.message));
      }
    } catch (error) {
      console.error('Error in bot chat:', error);
      res.status(500).json({ error: 'Failed to process bot chat' });
    }
  });

  return router;
};
