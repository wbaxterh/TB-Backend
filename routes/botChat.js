const express = require('express');
const router = express.Router();
const { MongoClient } = require('mongodb');
const auth = require('../middleware/auth');
const axios = require('axios');
require('dotenv').config();

// MongoDB connection
let db;
MongoClient.connect(process.env.ATLAS_URI, { useUnifiedTopology: true })
  .then(client => {
    db = client.db('TrickList2');
    console.log('Bot Chat API connected to MongoDB');
  })
  .catch(error => console.error('Bot Chat MongoDB connection error:', error));

// GET /api/bot-chat/bots - List all available bots
router.get('/bots', async (req, res) => {
  try {
    const bots = await db.collection('users').find({ 
      isBot: true 
    }).project({ 
      _id: 1, 
      name: 1, 
      bio: 1, 
      botCharacter: 1, 
      imageUri: 1 
    }).toArray();
    
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
    const bot = await db.collection('users').findOne({ _id: new (require('mongodb').ObjectId)(botId), isBot: true });
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    
    // Get chat history
    const chatHistory = await db.collection('bot_chats').find({
      $or: [
        { fromUserId: userId, toUserId: botId },
        { fromUserId: botId, toUserId: userId }
      ]
    }).sort({ createdAt: 1 }).toArray();
    
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
    
    if (!botId || !message) {
      return res.status(400).json({ error: 'botId and message are required' });
    }
    
    // Verify bot exists
    const bot = await db.collection('users').findOne({ _id: new (require('mongodb').ObjectId)(botId), isBot: true });
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    
    // Save user message
    const userMessage = {
      fromUserId: userId,
      toUserId: botId,
      userId: userId,
      type: 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const userMessageResult = await db.collection('bot_chats').insertOne(userMessage);
    userMessage._id = userMessageResult.insertedId;
    
    // Forward to ElizaOS API
    let botResponse;
    try {
      const elizaResponse = await axios.post('http://localhost:3001/api/chat', {
        userId: userId,
        message: message,
        character: bot.botCharacter || 'kaori'
      }, {
        timeout: 30000
      });
      
      botResponse = elizaResponse.data.response || 'Sorry, I had trouble responding to that!';
    } catch (elizaError) {
      console.error('ElizaOS API error:', elizaError.message);
      botResponse = 'Hey! I\'m having some technical difficulties right now. Can you try again in a moment? 🤖✨';
    }
    
    // Save bot response
    const botMessage = {
      fromUserId: botId,
      toUserId: userId,
      message: botResponse,
      type: 'bot',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const botMessageResult = await db.collection('bot_chats').insertOne(botMessage);
    botMessage._id = botMessageResult.insertedId;
    
    // Return both messages
    res.json({
      userMessage,
      botMessage
    });
    
  } catch (error) {
    console.error('Error in bot chat:', error);
    res.status(500).json({ error: 'Failed to process bot chat' });
  }
});

module.exports = router;