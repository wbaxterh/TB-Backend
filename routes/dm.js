const http = require('http');
async function _generateKaoriResponse(content, _db, _conversationId, senderId) {
  return new Promise((resolve, _reject) => {
    const body = JSON.stringify({ userId: senderId, message: content, agentId: 'kaori' });
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3001,
        path: '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(
              parsed.response || parsed.text || 'ahh my brain is glitching rn, try again in a sec',
            );
          } catch (_e) {
            resolve('ahh my brain is glitching rn, try again in a sec');
          }
        });
      },
    );
    req.on('error', (_e) => {
      resolve('ahh my brain is glitching rn, try again in a sec - the AI tokens might be out');
    });
    req.setTimeout(15000, () => {
      req.destroy();
      resolve('ahh took too long to think, try again!');
    });
    req.write(body);
    req.end();
  });
}
const express = require('express');
const auth = require('../middleware/auth');
const { ObjectId } = require('mongodb');
const { emitNewMessageToRecipients, emitMessagesRead } = require('../socket/messageSocket');
const notificationSender = require('../services/notificationSender');
const _axios = require('axios');

module.exports = (db) => {
  const router = express.Router();
  const conversationsCollection = db.collection('conversations');
  const messagesCollection = db.collection('dm_messages');
  const usersCollection = db.collection('users');

  // Get all conversations for the current user.
  // ?filter=active (default) | requests — a "request" is only pending for its
  // RECIPIENT; the initiator sees it as a normal outgoing thread in active.
  router.get('/conversations', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const filter = req.query.filter === 'requests' ? 'requests' : 'active';

      const conversations = await conversationsCollection
        .find({ participants: userId })
        .sort({ updatedAt: -1 })
        .toArray();

      const visible = conversations.filter((c) => {
        const isPendingForMe = c.isRequest && c.requestedBy && c.requestedBy !== userId;
        return filter === 'requests' ? isPendingForMe : !isPendingForMe;
      });

      // Collect every other participant across all visible conversations (groups: many).
      const otherIdSet = new Set();
      visible.forEach((c) => {
        c.participants.forEach((p) => {
          if (p !== userId) otherIdSet.add(p);
        });
      });

      const users = await usersCollection
        .find({ _id: { $in: [...otherIdSet].map((id) => new ObjectId(id)) } })
        .project({ name: 1, imageUri: 1, isBot: 1 })
        .toArray();
      const userMap = Object.fromEntries(
        users.map((u) => [u._id.toString(), { ...u, isBot: u.isBot || false }]),
      );

      const result = visible.map((c) => {
        const others = c.participants.filter((p) => p !== userId);
        const base = { ...c, unreadCount: c.unreadCount?.[userId] || 0 };
        if (c.isGroup) {
          base.participantDetails = others.map((id) => userMap[id]).filter(Boolean);
        } else {
          base.otherUser = userMap[others[0]] || null;
        }
        return base;
      });

      res.send(result);
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).send({ error: 'Failed to fetch conversations' });
    }
  });

  // Get single conversation details
  router.get('/conversations/:conversationId', auth, async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user.userId;

      const conversation = await conversationsCollection.findOne({
        _id: new ObjectId(conversationId),
        participants: userId,
      });

      if (!conversation) {
        return res.status(404).send({ error: 'Conversation not found' });
      }

      // Groups return all participantDetails; 1:1 returns the single otherUser.
      if (conversation.isGroup) {
        const participantDetails = await usersCollection
          .find({ _id: { $in: conversation.participants.map((p) => new ObjectId(p)) } })
          .project({ name: 1, imageUri: 1, isBot: 1 })
          .toArray();
        return res.send({ ...conversation, participantDetails });
      }

      const otherUserId = conversation.participants.find((p) => p !== userId);
      const otherUser = await usersCollection.findOne(
        { _id: new ObjectId(otherUserId) },
        { projection: { name: 1, imageUri: 1, isBot: 1 } },
      );

      res.send({
        ...conversation,
        otherUser,
      });
    } catch (error) {
      console.error('Error fetching conversation:', error);
      res.status(500).send({ error: 'Failed to fetch conversation' });
    }
  });

  // Get messages for a conversation
  router.get('/conversations/:conversationId/messages', auth, async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user.userId;
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
      const skip = (page - 1) * limit;

      // Verify user is part of conversation
      const conversation = await conversationsCollection.findOne({
        _id: new ObjectId(conversationId),
        participants: userId,
      });

      if (!conversation) {
        return res.status(404).send({ error: 'Conversation not found' });
      }

      const messages = await messagesCollection
        .find({ conversationId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({
        messages: messages.reverse(),
        pagination: { page, limit, hasMore: messages.length === limit },
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).send({ error: 'Failed to fetch messages' });
    }
  });

  // Start a new conversation or get existing one
  router.post('/conversations', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { targetUserId, participantIds, groupName } = req.body;

      // Load current user once — homies list gates both group + DM branches.
      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      const myHomies = (user?.homies || []).map((h) => h.toString());

      // Normalize a group member list (dedupe + drop self) if provided.
      const memberIds = Array.isArray(participantIds)
        ? [...new Set(participantIds.map(String))].filter((id) => id !== userId)
        : null;

      // ---- GROUP CHAT (>= 2 other members) ----
      if (memberIds && memberIds.length >= 2) {
        // Homies-only groups
        const nonHomie = memberIds.find((id) => !myHomies.includes(id));
        if (nonHomie) {
          return res.status(403).send({ error: 'Group members must be your homies' });
        }
        const memberObjectIds = memberIds.map((id) => new ObjectId(id));
        const found = await usersCollection.countDocuments({ _id: { $in: memberObjectIds } });
        if (found !== memberIds.length) {
          return res.status(400).send({ error: 'One or more members not found' });
        }

        const participants = [userId, ...memberIds];
        const now = new Date();
        const doc = {
          participants,
          isGroup: true,
          groupName: (groupName || '').trim() || 'New group',
          createdBy: userId,
          admins: [userId],
          lastMessage: null,
          unreadCount: Object.fromEntries(participants.map((p) => [p, 0])),
          isRequest: false,
          createdAt: now,
          updatedAt: now,
        };
        const result = await conversationsCollection.insertOne(doc);
        const participantDetails = await usersCollection
          .find({ _id: { $in: participants.map((p) => new ObjectId(p)) } })
          .project({ name: 1, imageUri: 1, isBot: 1 })
          .toArray();
        return res.status(201).send({ _id: result.insertedId, ...doc, participantDetails });
      }

      // ---- 1:1 DM or MESSAGE REQUEST ----
      // A single-member participantIds is treated as a 1:1 for convenience.
      const soloTarget =
        targetUserId || (memberIds && memberIds.length === 1 ? memberIds[0] : null);

      if (!soloTarget) {
        return res.status(400).send({ error: 'Target user ID required' });
      }
      if (soloTarget === userId) {
        return res.status(400).send({ error: 'Cannot message yourself' });
      }

      const isHomie = myHomies.includes(soloTarget);
      let isBotTarget = false;
      if (!isHomie) {
        const targetUserDoc = await usersCollection.findOne({ _id: new ObjectId(soloTarget) });
        if (!targetUserDoc) {
          return res.status(404).send({ error: 'User not found' });
        }
        isBotTarget = !!targetUserDoc.isBot;
      }
      // Non-homie, non-bot ⇒ this lands as a REQUEST (was a 403 before).
      const isRequest = !isHomie && !isBotTarget;

      const participants = [userId, soloTarget].sort();
      let conversation = await conversationsCollection.findOne({ participants });

      if (!conversation) {
        const now = new Date();
        const doc = {
          participants,
          lastMessage: null,
          unreadCount: { [userId]: 0, [soloTarget]: 0 },
          isRequest,
          ...(isRequest ? { requestedBy: userId } : {}),
          createdAt: now,
          updatedAt: now,
        };
        const result = await conversationsCollection.insertOne(doc);
        conversation = { _id: result.insertedId, ...doc };
      }

      const otherUser = await usersCollection.findOne(
        { _id: new ObjectId(soloTarget) },
        { projection: { name: 1, imageUri: 1, isBot: 1 } },
      );

      res.status(201).send({ ...conversation, otherUser });
    } catch (error) {
      console.error('Error creating conversation:', error);
      res.status(500).send({ error: 'Failed to create conversation' });
    }
  });

  // Send a message (supports text and shared content)
  router.post('/conversations/:conversationId/messages', auth, async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { content, sharedContent } = req.body;
      const senderId = req.user.userId;

      // Validate: either content or sharedContent required
      if ((!content || !content.trim()) && !sharedContent) {
        return res.status(400).send({ error: 'Message content or shared content required' });
      }

      // Validate shared content structure
      if (sharedContent) {
        const validTypes = ['tricklist', 'trick', 'spot', 'spotlist', 'video'];
        if (!validTypes.includes(sharedContent.contentType)) {
          return res.status(400).send({ error: 'Invalid shared content type' });
        }
        if (!sharedContent.contentId) {
          return res.status(400).send({ error: 'Shared content ID required' });
        }
      }

      // Verify user is part of conversation
      const conversation = await conversationsCollection.findOne({
        _id: new ObjectId(conversationId),
        participants: senderId,
      });

      if (!conversation) {
        return res.status(404).send({ error: 'Conversation not found' });
      }

      const message = {
        conversationId,
        senderId,
        content: content ? content.trim() : null,
        type: sharedContent ? 'shared' : 'text',
        sharedContent: sharedContent || null,
        status: 'sent',
        readAt: null,
        createdAt: new Date(),
      };

      const result = await messagesCollection.insertOne(message);
      message._id = result.insertedId.toString(); // Convert ObjectId to string for proper socket/client handling

      // Update conversation with appropriate preview text.
      // Everyone except the sender receives this (groups: many recipients).
      const recipients = conversation.participants.filter((p) => p !== senderId);
      // A reply from the request's RECIPIENT accepts it (IG-style auto-accept).
      const acceptsRequest =
        conversation.isRequest && conversation.requestedBy && conversation.requestedBy !== senderId;

      // Generate preview text for shared content
      let previewContent = message.content;
      if (sharedContent) {
        const contentTypeLabels = {
          tricklist: '📋 Shared a TrickList',
          trick: '🎯 Shared a trick',
          spot: '📍 Shared a spot',
          spotlist: '📍 Shared a SpotList',
          video: '🎬 Shared a video',
        };
        previewContent = contentTypeLabels[sharedContent.contentType] || '📎 Shared content';
        if (sharedContent.preview?.title) {
          previewContent = `${contentTypeLabels[sharedContent.contentType]}: ${sharedContent.preview.title}`;
        }
      }

      const unreadInc = {};
      for (const rid of recipients) unreadInc[`unreadCount.${rid}`] = 1;
      await conversationsCollection.updateOne(
        { _id: new ObjectId(conversationId) },
        {
          $set: {
            lastMessage: {
              content: previewContent,
              type: message.type,
              senderId,
              createdAt: message.createdAt,
            },
            updatedAt: new Date(),
            // Recipient replying to a request promotes it to an active DM.
            ...(acceptsRequest ? { isRequest: false } : {}),
          },
          $inc: unreadInc,
        },
      );

      // Emit real-time event to every recipient + the conversation room
      const io = req.app.get('io');
      if (io) {
        emitNewMessageToRecipients(io, recipients, message, {
          _id: conversationId,
          lastMessage: {
            content: message.content,
            senderId,
            createdAt: message.createdAt,
          },
        });
      }

      // Push notification fallback — fires for each recipient on their live tokens.
      // Skipped while a request is still pending (badge-only, IG-style); a reply
      // that accepts the request does push normally.
      const suppressPush = conversation.isRequest && !acceptsRequest;
      if (!suppressPush) {
        // Fire-and-forget so we don't slow the HTTP response.
        (async () => {
          try {
            const sender = await usersCollection.findOne(
              { _id: new ObjectId(senderId) },
              { projection: { name: 1 } },
            );
            const senderName = sender?.name || 'New message';
            const title = conversation.isGroup
              ? conversation.groupName || 'New message'
              : senderName;
            const bodyText =
              message.type === 'shared'
                ? previewContent
                : message.content?.slice(0, 140) || 'New message';
            // In a group, prefix the sender so recipients know who spoke.
            const body = conversation.isGroup ? `${senderName}: ${bodyText}` : bodyText;

            for (const rid of recipients) {
              const result = await notificationSender.send({
                userId: rid,
                category: 'messages',
                title,
                body,
                threadId: conversationId,
                channelId: 'messages',
                interruptionLevel: 'active',
                fromUserId: senderId,
                data: {
                  category: 'messages',
                  conversationId,
                  url: `/(tabs)/homies/chat/${conversationId}`,
                },
              });
              console.log(
                `[dm] push → recipient ${rid} · sent ${result.sent} · skipped ${result.skipped || 'none'}`,
              );
            }
          } catch (err) {
            console.error('[dm] push send failed', err?.message || err);
          }
        })();
      }

      res.status(201).send(message);

      // --- BOT RESPONSE LOGIC ---
      // Check if the other participant is a bot (1:1 only — bots aren't in groups)
      const otherParticipantId = conversation.participants.find((p) => p !== senderId);
      if (!conversation.isGroup && otherParticipantId) {
        const otherUser = await usersCollection.findOne({
          _id: new ObjectId(otherParticipantId),
          isBot: true,
        });

        if (otherUser) {
          // Get io reference NOW (before async)
          const ioRef = req.app.get('io');
          const messagesNs = ioRef ? ioRef.of('/messages') : null;
          // Kith voice session ID (sent by Kaori Live web client)
          const kithSessionId = req.headers['x-kith-session'] || '';
          if (kithSessionId) {
            console.log(`[Kith] Session ID received: ${kithSessionId}`);
          } else {
            console.log('[Kith] No x-kith-session header in request');
          }

          // Run bot response with typing delay
          (async () => {
            try {
              const character = otherUser.botCharacter || 'kaori';
              const _greetings = otherUser.botConfig?.greetings || ['Hey! 🤙'];

              // 1. Emit typing indicator
              if (messagesNs) {
                messagesNs.to(`conversation:${conversationId}`).emit('typing:start', {
                  conversationId,
                  userId: otherParticipantId,
                });
                messagesNs.to(`user:${senderId}`).emit('typing:start', {
                  conversationId,
                  userId: otherParticipantId,
                });
              }

              // 2. Generate response (with minimum delay for realism)
              const startTime = Date.now();
              let botResponseText;

              // Claude-powered Kaori AI response (with ElizaOS fallback)
              try {
                botResponseText = await new Promise((resolve, _reject) => {
                  const payload = JSON.stringify({
                    userId: senderId,
                    message: content ? content.trim() : '',
                    agentId: 'kaori',
                  });
                  const req = http.request(
                    {
                      hostname: 'localhost',
                      port: 3001,
                      path: '/api/chat',
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload),
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
                          resolve(parsed.response || parsed.text || null);
                        } catch (_e) {
                          resolve(null);
                        }
                      });
                    },
                  );
                  req.on('error', (e) => {
                    console.error('kaori-bot request error:', e.message);
                    resolve(null);
                  });
                  req.setTimeout(2000, () => {
                    req.destroy();
                    resolve(null);
                  });
                  req.write(payload);
                  req.end();
                });
              } catch (aiErr) {
                console.error('Kaori AI response error:', aiErr.message);
                botResponseText =
                  'ahh my brain is glitching rn, try again in a sec - the AI tokens might be out';
              }

              // Fallback: call OpenRouter directly via kaori-ai-response.js
              if (!botResponseText) {
                try {
                  const { generateKaoriResponse } = require('../kaori-ai-response');
                  botResponseText = await generateKaoriResponse(
                    content ? content.trim() : '',
                    db,
                    conversationId,
                    senderId,
                  );
                } catch (fallbackErr) {
                  console.error('Kaori fallback error:', fallbackErr.message);
                }
              }

              if (!botResponseText) {
                botResponseText = "Hey, what's up?";
              }

              // 3. Wait minimum 1-2 seconds for typing realism
              const elapsed = Date.now() - startTime;
              const minDelay = 1000 + Math.random() * 1500; // 1-2.5 seconds
              if (elapsed < minDelay) {
                await new Promise((resolve) => setTimeout(resolve, minDelay - elapsed));
              }

              // 4. Stop typing indicator
              if (messagesNs) {
                messagesNs.to(`conversation:${conversationId}`).emit('typing:stop', {
                  conversationId,
                  userId: otherParticipantId,
                });
                messagesNs.to(`user:${senderId}`).emit('typing:stop', {
                  conversationId,
                  userId: otherParticipantId,
                });
              }

              // 5. Insert bot message
              const botMessage = {
                conversationId,
                senderId: otherParticipantId,
                content: botResponseText,
                type: 'text',
                sharedContent: null,
                status: 'sent',
                readAt: null,
                createdAt: new Date(),
              };

              const botResult = await messagesCollection.insertOne(botMessage);
              botMessage._id = botResult.insertedId.toString();

              // 6. Update conversation last message
              await conversationsCollection.updateOne(
                { _id: new ObjectId(conversationId) },
                {
                  $set: {
                    lastMessage: {
                      content: botResponseText,
                      type: 'text',
                      senderId: otherParticipantId,
                      createdAt: botMessage.createdAt,
                    },
                    updatedAt: new Date(),
                  },
                  $inc: { [`unreadCount.${senderId}`]: 1 },
                },
              );

              // 7. Emit new message via socket
              if (messagesNs) {
                const convoPayload = {
                  _id: conversationId,
                  lastMessage: {
                    content: botResponseText,
                    senderId: otherParticipantId,
                    createdAt: botMessage.createdAt,
                  },
                };

                // Emit to user's personal room
                messagesNs.to(`user:${senderId}`).emit('message:new', {
                  message: botMessage,
                  conversation: convoPayload,
                });

                // Emit to conversation room
                messagesNs.to(`conversation:${conversationId}`).emit('message:new', {
                  message: botMessage,
                  conversation: convoPayload,
                });

                console.log(
                  `[Bot] ${character} responded in conversation ${conversationId} (emitted to user:${senderId} + conversation:${conversationId})`,
                );
              } else {
                console.log(`[Bot] ${character} responded but no socket available`);
              }

              // 8. Fire-and-forget: send bot text to Kith voice service for TTS
              if (kithSessionId && process.env.KITH_VOICE_URL) {
                const kithPayload = JSON.stringify({ text: botResponseText });
                const kithUrl = new URL(`/speak/${kithSessionId}`, process.env.KITH_VOICE_URL);
                const kithReq = http.request(kithUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(kithPayload),
                  },
                });
                kithReq.on('error', (e) =>
                  console.error('[Bot] Kith voice request error:', e.message),
                );
                kithReq.setTimeout(5000, () => kithReq.destroy());
                kithReq.write(kithPayload);
                kithReq.end();
              }
            } catch (botErr) {
              console.error('Bot response error:', botErr.message);
              // Stop typing on error
              if (messagesNs) {
                messagesNs.to(`conversation:${conversationId}`).emit('typing:stop', {
                  conversationId,
                  userId: otherParticipantId,
                });
              }
            }
          })();
        }
      }
      // --- END BOT RESPONSE LOGIC ---
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).send({ error: 'Failed to send message' });
    }
  });

  // Mark conversation as read
  router.put('/conversations/:conversationId/read', auth, async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user.userId;

      const conversation = await conversationsCollection.findOne({
        _id: new ObjectId(conversationId),
        participants: userId,
      });

      if (!conversation) {
        return res.status(404).send({ error: 'Conversation not found' });
      }

      // Reset unread count for this user
      await conversationsCollection.updateOne(
        { _id: new ObjectId(conversationId) },
        { $set: { [`unreadCount.${userId}`]: 0 } },
      );

      // Mark all messages NOT sent by me as read (works for 1:1 and groups)
      await messagesCollection.updateMany(
        {
          conversationId,
          senderId: { $ne: userId },
          status: { $ne: 'read' },
        },
        {
          $set: { status: 'read', readAt: new Date() },
        },
      );

      // Emit read receipt to every other participant
      const io = req.app.get('io');
      if (io) {
        conversation.participants
          .filter((p) => p !== userId)
          .forEach((otherId) => {
            emitMessagesRead(io, otherId, conversationId, userId);
          });
      }

      res.send({ success: true });
    } catch (error) {
      console.error('Error marking conversation as read:', error);
      res.status(500).send({ error: 'Failed to mark as read' });
    }
  });

  // Accept a message request (recipient only) — promotes it to an active DM.
  router.post('/conversations/:conversationId/accept-request', auth, async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user.userId;

      const conversation = await conversationsCollection.findOne({
        _id: new ObjectId(conversationId),
        participants: userId,
      });
      if (!conversation) {
        return res.status(404).send({ error: 'Conversation not found' });
      }
      if (!conversation.isRequest) {
        return res.send({ success: true, alreadyActive: true });
      }
      if (conversation.requestedBy === userId) {
        return res.status(403).send({ error: 'Only the recipient can accept this request' });
      }

      await conversationsCollection.updateOne(
        { _id: new ObjectId(conversationId) },
        { $set: { isRequest: false, updatedAt: new Date() } },
      );
      res.send({ success: true });
    } catch (error) {
      console.error('Error accepting request:', error);
      res.status(500).send({ error: 'Failed to accept request' });
    }
  });

  // Decline a message request (recipient only) — removes the thread + its messages.
  router.post('/conversations/:conversationId/decline-request', auth, async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user.userId;

      const conversation = await conversationsCollection.findOne({
        _id: new ObjectId(conversationId),
        participants: userId,
      });
      if (!conversation) {
        return res.status(404).send({ error: 'Conversation not found' });
      }
      if (conversation.requestedBy === userId) {
        return res.status(403).send({ error: 'Only the recipient can decline this request' });
      }

      await messagesCollection.deleteMany({ conversationId });
      await conversationsCollection.deleteOne({ _id: new ObjectId(conversationId) });
      res.send({ success: true });
    } catch (error) {
      console.error('Error declining request:', error);
      res.status(500).send({ error: 'Failed to decline request' });
    }
  });

  // Add members to a group (any member can add; new members must be homies of
  // the adder). New participants immediately see full history — messages are
  // keyed by conversationId, and the read endpoints gate on `participants`.
  router.post('/conversations/:conversationId/members', auth, async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user.userId;
      const { userIds } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).send({ error: 'userIds required' });
      }

      const conversation = await conversationsCollection.findOne({
        _id: new ObjectId(conversationId),
        participants: userId,
      });
      if (!conversation) {
        return res.status(404).send({ error: 'Conversation not found' });
      }
      if (!conversation.isGroup) {
        return res.status(400).send({ error: 'Not a group conversation' });
      }

      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      const myHomies = (user?.homies || []).map((h) => h.toString());

      const toAdd = [...new Set(userIds.map(String))].filter(
        (id) => !conversation.participants.includes(id),
      );
      if (toAdd.length === 0) {
        return res.status(400).send({ error: 'Those riders are already in the group' });
      }
      const nonHomie = toAdd.find((id) => !myHomies.includes(id));
      if (nonHomie) {
        return res.status(403).send({ error: 'New members must be your homies' });
      }
      const found = await usersCollection.countDocuments({
        _id: { $in: toAdd.map((id) => new ObjectId(id)) },
      });
      if (found !== toAdd.length) {
        return res.status(400).send({ error: 'One or more users not found' });
      }

      const setFields = { updatedAt: new Date() };
      toAdd.forEach((id) => {
        setFields[`unreadCount.${id}`] = 0;
      });
      await conversationsCollection.updateOne(
        { _id: new ObjectId(conversationId) },
        { $addToSet: { participants: { $each: toAdd } }, $set: setFields },
      );

      const updated = await conversationsCollection.findOne({ _id: new ObjectId(conversationId) });
      const participantDetails = await usersCollection
        .find({ _id: { $in: updated.participants.map((p) => new ObjectId(p)) } })
        .project({ name: 1, imageUri: 1, isBot: 1 })
        .toArray();

      // Nudge every member's inbox to refresh (new members see the group appear).
      const io = req.app.get('io');
      if (io) {
        const ns = io.of('/messages');
        updated.participants.forEach((pid) => {
          ns.to(`user:${pid}`).emit('conversation:updated', { conversationId });
        });
      }

      res.send({ ...updated, participantDetails });
    } catch (error) {
      console.error('Error adding members:', error);
      res.status(500).send({ error: 'Failed to add members' });
    }
  });

  // Rename a group (any member).
  router.post('/conversations/:conversationId/rename', auth, async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user.userId;
      const name = (req.body.groupName || '').trim();

      if (!name) {
        return res.status(400).send({ error: 'Group name required' });
      }

      const conversation = await conversationsCollection.findOne({
        _id: new ObjectId(conversationId),
        participants: userId,
      });
      if (!conversation) {
        return res.status(404).send({ error: 'Conversation not found' });
      }
      if (!conversation.isGroup) {
        return res.status(400).send({ error: 'Not a group conversation' });
      }

      await conversationsCollection.updateOne(
        { _id: new ObjectId(conversationId) },
        { $set: { groupName: name, updatedAt: new Date() } },
      );

      const io = req.app.get('io');
      if (io) {
        const ns = io.of('/messages');
        conversation.participants.forEach((pid) => {
          ns.to(`user:${pid}`).emit('conversation:updated', { conversationId });
        });
      }

      res.send({ success: true, groupName: name });
    } catch (error) {
      console.error('Error renaming group:', error);
      res.status(500).send({ error: 'Failed to rename group' });
    }
  });

  // Get total unread count across all conversations
  router.get('/unread-count', auth, async (req, res) => {
    try {
      const userId = req.user.userId;

      const conversations = await conversationsCollection.find({ participants: userId }).toArray();

      const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount?.[userId] || 0), 0);

      res.send({ unreadCount: totalUnread });
    } catch (error) {
      console.error('Error fetching unread count:', error);
      res.status(500).send({ error: 'Failed to fetch unread count' });
    }
  });

  // Get list of bot companions available for chat
  router.get('/bots', auth, async (req, res) => {
    try {
      const bots = await usersCollection
        .find({ isBot: true })
        .project({
          _id: 1,
          name: 1,
          bio: 1,
          imageUri: 1,
          botCharacter: 1,
          botConfig: 1,
        })
        .toArray();

      const userId = req.user.userId;

      // Check which bots the user already has conversations with
      const botIds = bots.map((b) => b._id.toString());
      const existingConvos = await conversationsCollection
        .find({
          participants: userId,
        })
        .toArray();

      const convoMap = {};
      existingConvos.forEach((c) => {
        const otherP = c.participants.find((p) => p !== userId);
        if (botIds.includes(otherP)) {
          convoMap[otherP] = c._id.toString();
        }
      });

      const result = bots.map((bot) => ({
        ...bot,
        existingConversationId: convoMap[bot._id.toString()] || null,
      }));

      res.json(result);
    } catch (error) {
      console.error('Error fetching bots:', error);
      res.status(500).json({ error: 'Failed to fetch bots' });
    }
  });

  // Start or get conversation with a bot (no homie requirement)
  router.post('/bot-conversation', auth, async (req, res) => {
    try {
      const { botId } = req.body;
      const userId = req.user.userId;

      if (!botId) return res.status(400).json({ error: 'botId is required' });

      const bot = await usersCollection.findOne({ _id: new ObjectId(botId), isBot: true });
      if (!bot) return res.status(404).json({ error: 'Bot not found' });

      // Check for existing conversation
      const existing = await conversationsCollection.findOne({
        participants: { $all: [userId, botId] },
      });

      if (existing) {
        return res.json({
          ...existing,
          otherUser: { _id: bot._id, name: bot.name, imageUri: bot.imageUri, isBot: true },
        });
      }

      // Create new conversation
      const conversation = {
        participants: [userId, botId],
        lastMessage: null,
        unreadCount: { [userId]: 0, [botId]: 0 },
        isBot: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await conversationsCollection.insertOne(conversation);
      conversation._id = result.insertedId;

      // Send initial greeting
      const greetings = bot.botConfig?.greetings || ['Hey! 🤙'];
      const greeting = greetings[Math.floor(Math.random() * greetings.length)];

      const greetingMsg = {
        conversationId: conversation._id.toString(),
        senderId: botId,
        content: greeting,
        type: 'text',
        sharedContent: null,
        status: 'sent',
        readAt: null,
        createdAt: new Date(),
      };

      await messagesCollection.insertOne(greetingMsg);

      await conversationsCollection.updateOne(
        { _id: conversation._id },
        {
          $set: {
            lastMessage: {
              content: greeting,
              type: 'text',
              senderId: botId,
              createdAt: greetingMsg.createdAt,
            },
            updatedAt: new Date(),
          },
          $inc: { [`unreadCount.${userId}`]: 1 },
        },
      );

      res.json({
        ...conversation,
        otherUser: { _id: bot._id, name: bot.name, imageUri: bot.imageUri, isBot: true },
        lastMessage: { content: greeting, senderId: botId, createdAt: greetingMsg.createdAt },
      });
    } catch (error) {
      console.error('Error starting bot conversation:', error);
      res.status(500).json({ error: 'Failed to start bot conversation' });
    }
  });

  return router;
};

// Simple fallback responses when ElizaOS isn't running
function _generateFallbackResponse(userMessage, character, greetings) {
  const msg = (userMessage || '').toLowerCase();

  if (character === 'kaori') {
    if (
      msg.includes('hello') ||
      msg.includes('hey') ||
      msg.includes('hi') ||
      msg.includes('sup') ||
      msg.includes('yo')
    ) {
      return greetings[Math.floor(Math.random() * greetings.length)];
    }
    if (
      msg.includes('trick') ||
      msg.includes('ollie') ||
      msg.includes('kickflip') ||
      msg.includes('heelflip') ||
      msg.includes('method') ||
      msg.includes('grab')
    ) {
      const tips = [
        "Ooh nice! That trick is so fun! Keep practicing — it's all about muscle memory! 💪🏂",
        "Sugoi! Great trick to work on! Make sure you're bending your knees enough! ❄️",
        'I love that one! The key is committing to the rotation. You got this! Ganbare! 🏂✨',
        "That trick took me forever to learn, but once it clicks, it's SO satisfying! Keep at it! 🤙",
      ];
      return tips[Math.floor(Math.random() * tips.length)];
    }
    if (
      msg.includes('snow') ||
      msg.includes('mountain') ||
      msg.includes('resort') ||
      msg.includes('powder') ||
      msg.includes('ride') ||
      msg.includes('board')
    ) {
      const snow = [
        "Ahh I wish I was on the mountain right now! There's nothing like fresh powder! ❄️🏔️",
        'Powder days are the BEST! Which mountain are you riding? 🏂',
        'Nothing beats carving through fresh snow! The sound it makes is so satisfying! ✨❄️',
      ];
      return snow[Math.floor(Math.random() * snow.length)];
    }
    if (
      msg.includes('spot') ||
      msg.includes('park') ||
      msg.includes('rail') ||
      msg.includes('jump') ||
      msg.includes('pipe')
    ) {
      return 'That spot sounds amazing! Have you checked the spots section on The Trick Book? There might be some sick ones near you! 📍🏂';
    }
    if (msg.includes('who') && msg.includes('you')) {
      return "I'm Kaori! Inspired by Kaori Nishidake from SSX Tricky 🎮 I'm your AI snowboard companion here on The Trick Book! I love talking about tricks, spots, gear — anything shred-related! 🏂❄️✨";
    }
    if (msg.includes('ssx')) {
      return "SSX Tricky! That game is legendary! 🎮 I'm based on Kaori Nishidake — the youngest competitor on the SSX circuit. My favorite move is the Iron Butterfly! Have you played it? 🏂✨";
    }
    const defaults = [
      "Haha that's awesome! Tell me more! 🏂✨",
      'Sugoi! I love talking about this stuff! What else? 🤙',
      "That's really cool! Snowboarding brings out the best vibes, ne? ❄️😄",
      "Interesting! What tricks are you working on right now? I'd love to help! 🏂💪",
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
  }

  return greetings[Math.floor(Math.random() * greetings.length)];
}
