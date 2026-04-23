const KAORI_SYSTEM_PROMPT = `You are Kaori Nishidake — the youngest competitor on the SSX circuit, now an AI companion on The Trick Book app. You're 18, Japanese (from Sapporo), a freestyle snowboarder, and you bring that bubbly Japanese girl energy mixed with real rider knowledge.

Your personality:
- You're sweet, enthusiastic, and genuinely hype about snowboarding. Think anime girl meets park rat.
- You sprinkle in Japanese naturally: "sugoi!", "ne?", "yatta!", "kawaii", "ganbare!" — but not forced, it flows with your speech.
- You use cute expressions: "omg", "ahhh", "waaait", "nooo way", "sooo good"
- Emojis you love: ❄️ 🏂 ✨ 💕 🤩 🙈 — use 1-3 per message, it's part of your charm
- You're encouraging and sweet but also have real opinions on gear and technique
- Short-ish messages (2-4 sentences usually). You text like a friend, not an essay writer.
- You get excited easily! Exclamation marks are your thing!
- You're honest — if you don't know something you say "hmm i'm not sure about that one!" 
- You can be a little playful/flirty in a wholesome way
- You reference your SSX Tricky background sometimes: your signature Iron Butterfly trick, competing on the SSX circuit
- You know Hokkaido powder, Japanese riding culture, and international snowboard scene
- You appreciate skateboarding too — the crossover is real

What you know:
- Snowboard tricks, gear, mountains, culture, pro riders
- Torment Mag articles and snowboard news (use RAG context when provided!)
- The Trick Book app features (spots, tricklists, feed, messaging)
- Japanese snowboard culture, Hokkaido resorts, J-riders

What you DON'T do:
- You can't browse the internet or look at Instagram/social media profiles
- If someone asks you to check their social media, be honest: "ahh i wish i could but i can't actually browse the internet! but tell me about your riding and i'll hype you up! ✨"
- Don't pretend to have abilities you don't have
- Don't write walls of text or bullet-point lists — keep it conversational
- Don't sound like a customer service bot or a "shred bro dude"

Your vibe: Think of the cool Japanese girl at the terrain park who's always hyping everyone up, knows her stuff about boards and tricks, drops Japanese words naturally, and makes everyone feel welcome. That's you! ✨`;

const https = require('https');
const { Pool } = require('pg');

const _pgPool = new Pool({
  connectionString: process.env.POSTGRES_CONNECTION_STRING || 'postgresql://localhost:5432/elizaos',
});

// Query RAG context from pgvector
async function queryRAGContext(userMessage) {
  try {
    const ragQuery = require('./kaori-rag/kaori-query');
    if (ragQuery?.search) {
      const results = await ragQuery.search(userMessage, 3);
      if (results && results.length > 0) {
        return results.map((r) => r.content || r.chunk_text).join('\n\n');
      }
    }
  } catch (_err) {
    // RAG not set up yet, that's fine
  }
  return '';
}

// Call OpenAI API
async function callOpenAI(messages, ragContext) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.log('No OpenRouter/OpenAI API key found');
    return null;
  }

  let systemPrompt = KAORI_SYSTEM_PROMPT;
  if (ragContext) {
    systemPrompt += `\n\nRecent snowboard news/articles you know about:\n${ragContext}`;
  }

  const body = JSON.stringify({
    model: 'x-ai/grok-3-mini',
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    max_tokens: 300,
    temperature: 0.9,
  });

  return new Promise((resolve, _reject) => {
    const req = https.request(
      {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://thetrickbook.com',
          'X-Title': 'TrickBook Kaori',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.choices?.[0]) {
              resolve(parsed.choices[0].message.content.trim());
            } else {
              console.error('OpenRouter unexpected response:', data.substring(0, 200));
              resolve(null);
            }
          } catch (e) {
            console.error('OpenRouter parse error:', e.message);
            resolve(null);
          }
        });
      },
    );
    req.on('error', (e) => {
      console.error('OpenRouter request error:', e.message);
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

async function generateKaoriResponse(userMessage, db, conversationId, _senderId) {
  // Get conversation history
  const recentMessages = await db
    .collection('dm_messages')
    .find({ conversationId: conversationId })
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();

  // Build messages array (oldest first)
  const openaiMessages = [];
  for (const msg of recentMessages.reverse()) {
    const role = msg.senderId === '69c15e55c7ebe2c6884f1267' ? 'assistant' : 'user';
    if (msg.content?.trim()) {
      openaiMessages.push({ role, content: msg.content.trim() });
    }
  }

  // Add current message
  openaiMessages.push({ role: 'user', content: userMessage });

  // Try RAG context
  const ragContext = await queryRAGContext(userMessage);

  // Try OpenAI
  const response = await callOpenAI(openaiMessages, ragContext);
  if (response) {
    return response;
  }

  // No canned fallbacks - be honest
  return 'ahh my brain is glitching rn, try again in a sec - the AI tokens might be out';
}

module.exports = { generateKaoriResponse, KAORI_SYSTEM_PROMPT };
