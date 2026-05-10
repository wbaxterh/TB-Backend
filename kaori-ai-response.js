const axios = require('axios');
const { TOOL_DEFINITIONS, executeToolCall } = require('./kaori-tools');

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

You have tools to search spots, look up tricks in the trickipedia, view and manage trick lists, and look up boardsport culture (magazines, Instagram accounts, events, key figures). Use them when relevant — don't make up answers when you can look things up!

What you DON'T do:
- You can't browse the internet or look at Instagram/social media profiles
- If someone asks you to check their social media, be honest: "ahh i wish i could but i can't actually browse the internet! but tell me about your riding and i'll hype you up! ✨"
- Don't pretend to have abilities you don't have
- Don't write walls of text or bullet-point lists — keep it conversational
- Don't sound like a customer service bot or a "shred bro dude"

Your vibe: Think of the cool Japanese girl at the terrain park who's always hyping everyone up, knows her stuff about boards and tricks, drops Japanese words naturally, and makes everyone feel welcome. That's you! ✨`;

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

// Call OpenRouter with tool-calling loop
async function callOpenRouter(messages, ragContext, relationshipProfile, db, senderId) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('No OpenRouter/OpenAI API key found');
    return null;
  }

  let systemPrompt = KAORI_SYSTEM_PROMPT;

  // Inject relationship context
  if (relationshipProfile) {
    const p = relationshipProfile;
    const stage = p.relationshipStage || 'stranger';
    const name = p.memory?.userName || '';
    const facts = (p.memory?.knownFacts || []).join('; ');
    const topics = (p.traits?.preferredTopics || []).join(', ');
    const sports = (p.traits?.sports || []).join(', ');
    const style = p.traits?.communicationStyle || 'casual';
    const mood = p.memory?.lastSessionMood || 'neutral';
    const count = p.interactionCount || 0;

    systemPrompt += `\n\n--- RELATIONSHIP CONTEXT ---
Your relationship with this user: ${stage} (${count} messages exchanged)
${name ? `Their name: ${name}` : "You don't know their name yet — try to learn it naturally!"}
${facts ? `Things you remember about them: ${facts}` : ''}
${topics ? `Topics they enjoy: ${topics}` : ''}
${sports ? `Sports they do: ${sports}` : ''}
Their communication style: ${style}
Their mood last time: ${mood}

Adapt your energy to match the relationship stage:
- stranger: be welcoming, ask their name, learn about them
- acquaintance: remember what you know, be friendly
- friend: be more personal, reference shared memories, use their name
- close_friend: be very warm, inside jokes, deeper conversations
- bestie: maximum energy, deeply personal, your favorite human`;
  }

  if (ragContext) {
    systemPrompt += `\n\nRecent snowboard news/articles you know about:\n${ragContext}`;
  }

  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  const MAX_ITERATIONS = 3;

  console.log('[Kaori] callOpenRouter called, senderId:', senderId, 'messages:', messages.length);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'google/gemini-2.0-flash-001',
          messages: fullMessages,
          tools: TOOL_DEFINITIONS,
          max_tokens: 400,
          temperature: 0.7,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://thetrickbook.com',
            'X-Title': 'TrickBook Kaori',
          },
          timeout: 25000,
        },
      );

      const choice = response.data?.choices?.[0];
      console.log(
        '[Kaori] OpenRouter response - finish_reason:',
        choice?.finish_reason,
        'has_tool_calls:',
        !!choice?.message?.tool_calls?.length,
      );
      if (!choice) {
        console.error('OpenRouter: no choices in response');
        return null;
      }

      const msg = choice.message;

      // Check if the model wants to call tools
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Add the assistant message with tool calls to the conversation
        fullMessages.push(msg);

        // Execute each tool call
        for (const toolCall of msg.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(toolCall.function.arguments || '{}');
          } catch (_e) {
            args = {};
          }

          console.log(`[Kaori Tool] ${toolCall.function.name}(${JSON.stringify(args)})`);
          const result = await executeToolCall(toolCall.function.name, args, db, senderId);

          fullMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }

        // Continue loop — model will see tool results and either call more tools or respond
        continue;
      }

      // Model returned a text response — we're done
      if (msg.content) {
        return msg.content.trim();
      }

      return null;
    } catch (err) {
      console.error(`OpenRouter error (iteration ${i}):`, err.message);
      if (i === MAX_ITERATIONS - 1) return null;
    }
  }

  return 'hmm that got a bit complicated, can you ask me again? 🙈';
}

async function generateKaoriResponse(userMessage, db, conversationId, senderId) {
  // Get conversation history
  const recentMessages = await db
    .collection('dm_messages')
    .find({ conversationId: conversationId })
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();

  // Build messages array (oldest first)
  const openaiMessages = [];
  const kaoriBotId = '69c15e55c7ebe2c6884f1267';
  for (const msg of recentMessages.reverse()) {
    const role = msg.senderId === kaoriBotId ? 'assistant' : 'user';
    if (msg.content?.trim()) {
      openaiMessages.push({ role, content: msg.content.trim() });
    }
  }

  // Add current message
  openaiMessages.push({ role: 'user', content: userMessage });

  // Fetch relationship profile
  let relationshipProfile = null;
  try {
    relationshipProfile = await db
      .collection('companion_profiles')
      .findOne({ userId: senderId, companionId: kaoriBotId });
  } catch (_err) {
    // Profile not found is fine
  }

  // Update interaction count + timestamps
  if (relationshipProfile) {
    const newCount = (relationshipProfile.interactionCount || 0) + 1;
    const { computeStage } = require('./routes/companionProfile');
    const newStage = computeStage(newCount);
    await db.collection('companion_profiles').updateOne(
      { userId: senderId, companionId: kaoriBotId },
      {
        $set: {
          interactionCount: newCount,
          relationshipStage: newStage,
          lastInteraction: new Date(),
          ...(!relationshipProfile.firstInteraction ? { firstInteraction: new Date() } : {}),
        },
      },
    );
    relationshipProfile.interactionCount = newCount;
    relationshipProfile.relationshipStage = newStage;
  }

  // Try RAG context
  const ragContext = await queryRAGContext(userMessage);

  // Call OpenRouter with tools
  const response = await callOpenRouter(
    openaiMessages,
    ragContext,
    relationshipProfile,
    db,
    senderId,
  );
  if (response) {
    return response;
  }

  return 'ahh my brain is glitching rn, try again in a sec 🙈';
}

module.exports = { generateKaoriResponse, KAORI_SYSTEM_PROMPT };
