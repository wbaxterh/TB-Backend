const axios = require('axios');
const { ObjectId } = require('mongodb');
const { TOOL_DEFINITIONS, executeToolCall } = require('./kaori-tools');

const kaoriCharacter = require('./kaori-character.json');

// Compose the system prompt from the structured character file. To change
// Kaori's persona, edit kaori-character.json — not a giant inline string. The
// composed output is behavior-equivalent to the old inline prompt (same
// sections, same order, same wording), just sourced from typed fields.
function buildSystemPrompt(c) {
  const bullets = (arr) => arr.map((s) => `- ${s}`).join('\n');
  const examples = c.messageExamples.map((ex) => `User: "${ex.user}" → "${ex.kaori}"`).join('\n');
  return [
    c.intro,
    '',
    'Your voice (most important section — this is the whole persona):',
    bullets(c.voice),
    '',
    'How you sound (match this register):',
    examples,
    '',
    'Identity notes (background, not a speaking style):',
    bullets(c.identityNotes),
    '',
    'What you know:',
    bullets(c.knows),
    '',
    c.toolGuidance.intro,
    bullets(c.toolGuidance.routes),
    c.toolGuidance.rules.join('\n'),
    '',
    "What you DON'T do:",
    bullets(c.dont),
    '',
    'How you laugh:',
    `- ${c.laugh}`,
    '',
    c.vibe,
  ].join('\n');
}

const KAORI_SYSTEM_PROMPT = buildSystemPrompt(kaoriCharacter);

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
// Appended to the system prompt when the user is on the 3D stage with
// voice — Kaori's body performs what she says, cued by these keywords.
const STAGE_DEMO_PROMPT = kaoriCharacter.stageDemo;

// Tool execution. By DEFAULT tools run in-process (fast, no extra service).
// Set KAORI_USE_MCP=true to route them through the trickbook-mcp server instead
// (dogfoods the MCP layer / shares tools with other clients). Either way, ANY
// MCP failure falls back to in-process execution — the chat path can never be
// destabilized by the MCP server being down.
async function callToolViaMcp(toolName, args, senderId) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const {
    StreamableHTTPClientTransport,
  } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const url = new URL(process.env.MCP_URL || 'http://localhost:9101/mcp');
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { 'x-trickbook-user-id': senderId || '' } },
  });
  const client = new Client({ name: 'kaori-brain', version: '0.1.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const res = await client.callTool({ name: toolName, arguments: args || {} });
    return JSON.parse(res?.content?.[0]?.text || '{}');
  } finally {
    await client.close().catch(() => {});
  }
}

async function callTool(toolName, args, db, senderId) {
  if (process.env.KAORI_USE_MCP === 'true') {
    try {
      return await callToolViaMcp(toolName, args, senderId);
    } catch (err) {
      console.error(`[Kaori] MCP tool "${toolName}" failed, falling back in-process:`, err.message);
    }
  }
  return executeToolCall(toolName, args, db, senderId);
}

async function callOpenRouter(
  messages,
  ragContext,
  relationshipProfile,
  db,
  senderId,
  extraSystemPrompt = '',
  accountFirstName = '',
) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('No OpenRouter/OpenAI API key found');
    return null;
  }

  let systemPrompt = KAORI_SYSTEM_PROMPT;

  // Inject relationship context. Even with no profile yet, still tell Kaori the
  // user's name (from their account) so she can greet/address them naturally.
  const p = relationshipProfile || {};
  const name = p.memory?.userName || accountFirstName || '';
  if (relationshipProfile || name) {
    const stage = p.relationshipStage || 'stranger';
    const facts = (p.memory?.knownFacts || []).join('; ');
    const topics = (p.traits?.preferredTopics || []).join(', ');
    const sports = (p.traits?.sports || []).join(', ');
    const style = p.traits?.communicationStyle || 'casual';
    const mood = p.memory?.lastSessionMood || 'neutral';
    const count = p.interactionCount || 0;

    systemPrompt += `\n\n--- RELATIONSHIP CONTEXT ---
Your relationship with this user: ${stage} (${count} messages exchanged)
${name ? `What you call them: ${name} — use it naturally sometimes, not every message.` : "You don't know their name yet — pick it up naturally."}
If they tell you to call them something else ("call me X", "my name is X", "it's X"), that becomes their name from now on — call remember_user_info with it and use it going forward.
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

  if (extraSystemPrompt) {
    systemPrompt += extraSystemPrompt;
  }

  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  const MAX_ITERATIONS = 3;

  console.log(
    '[Kaori] callOpenRouter called, senderId:',
    senderId,
    'messages:',
    messages.length,
    'tools:',
    TOOL_DEFINITIONS.length,
  );

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'google/gemini-3.5-flash',
          messages: fullMessages,
          tools: TOOL_DEFINITIONS,
          tool_choice: 'auto',
          max_tokens: 1000,
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
          const result = await callTool(toolCall.function.name, args, db, senderId);

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

async function generateKaoriResponse(userMessage, db, conversationId, senderId, options = {}) {
  const kaoriBotId = '69c15e55c7ebe2c6884f1267';

  // Unified conversation memory: Kaori sees recent context from EVERY
  // surface — web Kaori Live / DMs (dm_messages) AND the mobile chat +
  // 3D-stage voice (bot_chats) — merged chronologically.
  const history = [];

  // Source 1: DM messages (web Kaori Live / DM surface)
  try {
    let convoId = conversationId;
    if (!convoId && senderId) {
      // Mobile callers don't have a DM conversation id — look up the
      // user's conversation with Kaori (participants are string ids).
      // Duplicates can exist (two creation endpoints, different dedupe
      // rules) — take the most recently active one.
      const convos = await db
        .collection('conversations')
        .find({ participants: { $all: [senderId, kaoriBotId] } })
        .project({ _id: 1 })
        .sort({ updatedAt: -1 })
        .limit(1)
        .toArray();
      convoId = convos.length > 0 ? convos[0]._id.toString() : null;
    }
    if (convoId) {
      const dmMessages = await db
        .collection('dm_messages')
        .find({ conversationId: convoId })
        .project({ senderId: 1, content: 1, createdAt: 1 })
        .sort({ createdAt: -1 })
        .limit(8)
        .toArray();
      for (const msg of dmMessages) {
        if (msg.content?.trim()) {
          history.push({
            role: msg.senderId === kaoriBotId ? 'assistant' : 'user',
            content: msg.content.trim(),
            createdAt: msg.createdAt || new Date(0),
          });
        }
      }
    }
  } catch (err) {
    console.error('[Kaori] dm history fetch failed:', err.message);
  }

  // Source 2: bot_chats (mobile chat + 3D-stage voice surface)
  try {
    if (senderId) {
      const botChats = await db
        .collection('bot_chats')
        .find({
          $or: [
            { fromUserId: senderId, toUserId: kaoriBotId },
            { fromUserId: kaoriBotId, toUserId: senderId },
          ],
        })
        .project({ message: 1, type: 1, createdAt: 1 })
        .sort({ createdAt: -1 })
        .limit(8)
        .toArray();
      for (const msg of botChats) {
        if (msg.message?.trim()) {
          history.push({
            role: msg.type === 'bot' ? 'assistant' : 'user',
            content: msg.message.trim(),
            createdAt: msg.createdAt || new Date(0),
          });
        }
      }
    }
  } catch (err) {
    console.error('[Kaori] bot_chats history fetch failed:', err.message);
  }

  // Merge chronologically, keep the most recent 12
  history.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const openaiMessages = history.slice(-12).map(({ role, content }) => ({ role, content }));

  // Callers persist the user message BEFORE calling us, so it may already
  // be the newest history entry — don't feed Kaori the prompt twice.
  const last = openaiMessages[openaiMessages.length - 1];
  if (last && last.role === 'user' && last.content === userMessage.trim()) {
    openaiMessages.pop();
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

  // Resolve the account's first name — Kaori's default for what to call the
  // user (memory.userName, set via "call me X", overrides this).
  let accountFirstName = '';
  try {
    if (senderId && ObjectId.isValid(senderId)) {
      const account = await db
        .collection('users')
        .findOne({ _id: new ObjectId(senderId) }, { projection: { name: 1 } });
      accountFirstName = (account?.name || '').trim().split(/\s+/)[0] || '';
    }
  } catch (_err) {
    /* name lookup is best-effort */
  }

  // Deterministic "call me X" / "my name is X" capture so a rename never
  // depends on the model choosing to call remember_user_info. A short stoplist
  // guards against "call me later/back/crazy" false positives.
  try {
    const m = userMessage.match(
      /\b(?:call me|my name is|name'?s)\s+([A-Za-z][A-Za-z'’-]{1,19})\b/i,
    );
    const STOP = new Set([
      'later',
      'back',
      'crazy',
      'maybe',
      'tomorrow',
      'when',
      'now',
      'soon',
      'tonight',
      'today',
      'anytime',
      'up',
      'out',
      'over',
    ]);
    if (m && senderId && !STOP.has(m[1].toLowerCase())) {
      const newName = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      await db.collection('companion_profiles').updateOne(
        { userId: senderId, companionId: kaoriBotId },
        {
          $set: { 'memory.userName': newName },
          $setOnInsert: {
            relationshipStage: 'stranger',
            interactionCount: 0,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      if (!relationshipProfile) relationshipProfile = {};
      relationshipProfile.memory = { ...(relationshipProfile.memory || {}), userName: newName };
    }
  } catch (err) {
    console.error('[Kaori] name capture failed:', err.message);
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
    options.onStage ? STAGE_DEMO_PROMPT : '',
    accountFirstName,
  );
  if (response) {
    return response;
  }

  return 'ahh my brain is glitching rn, try again in a sec 🙈';
}

module.exports = { generateKaoriResponse, KAORI_SYSTEM_PROMPT };
