const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { MongoClient, ObjectId } = require("mongodb");
const { emitNewMessage, emitMessagesRead } = require("../socket/messageSocket");

MongoClient.connect(process.env.ATLAS_URI, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const conversationsCollection = db.collection("conversations");
		const messagesCollection = db.collection("dm_messages");
		const usersCollection = db.collection("users");

		// Get all conversations for the current user
		router.get("/conversations", auth, async (req, res) => {
			try {
				const userId = req.user.userId;

				const conversations = await conversationsCollection
					.find({ participants: userId })
					.sort({ updatedAt: -1 })
					.toArray();

				// Get other participants' info
				const otherUserIds = conversations.map((c) =>
					c.participants.find((p) => p !== userId)
				);

				const users = await usersCollection
					.find({
						_id: { $in: otherUserIds.map((id) => new ObjectId(id)) },
					})
					.project({ name: 1, imageUri: 1 })
					.toArray();

				const userMap = Object.fromEntries(
					users.map((u) => [u._id.toString(), u])
				);

				const result = conversations.map((c) => ({
					...c,
					otherUser: userMap[c.participants.find((p) => p !== userId)],
					unreadCount: c.unreadCount?.[userId] || 0,
				}));

				res.send(result);
			} catch (error) {
				console.error("Error fetching conversations:", error);
				res.status(500).send({ error: "Failed to fetch conversations" });
			}
		});

		// Get single conversation details
		router.get("/conversations/:conversationId", auth, async (req, res) => {
			try {
				const { conversationId } = req.params;
				const userId = req.user.userId;

				const conversation = await conversationsCollection.findOne({
					_id: new ObjectId(conversationId),
					participants: userId,
				});

				if (!conversation) {
					return res.status(404).send({ error: "Conversation not found" });
				}

				// Get other user info
				const otherUserId = conversation.participants.find((p) => p !== userId);
				const otherUser = await usersCollection.findOne(
					{ _id: new ObjectId(otherUserId) },
					{ projection: { name: 1, imageUri: 1 } }
				);

				res.send({
					...conversation,
					otherUser,
				});
			} catch (error) {
				console.error("Error fetching conversation:", error);
				res.status(500).send({ error: "Failed to fetch conversation" });
			}
		});

		// Get messages for a conversation
		router.get(
			"/conversations/:conversationId/messages",
			auth,
			async (req, res) => {
				try {
					const { conversationId } = req.params;
					const userId = req.user.userId;
					const page = parseInt(req.query.page) || 1;
					const limit = Math.min(parseInt(req.query.limit) || 50, 100);
					const skip = (page - 1) * limit;

					// Verify user is part of conversation
					const conversation = await conversationsCollection.findOne({
						_id: new ObjectId(conversationId),
						participants: userId,
					});

					if (!conversation) {
						return res.status(404).send({ error: "Conversation not found" });
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
					console.error("Error fetching messages:", error);
					res.status(500).send({ error: "Failed to fetch messages" });
				}
			}
		);

		// Start a new conversation or get existing one
		router.post("/conversations", auth, async (req, res) => {
			try {
				const userId = req.user.userId;
				const { targetUserId } = req.body;

				if (!targetUserId) {
					return res.status(400).send({ error: "Target user ID required" });
				}

				if (targetUserId === userId) {
					return res.status(400).send({ error: "Cannot message yourself" });
				}

				// Verify they are homies
				const user = await usersCollection.findOne({
					_id: new ObjectId(userId),
				});

				const isHomie =
					user?.homies?.some((h) => h.toString() === targetUserId) ||
					user?.homies?.includes(targetUserId);

				if (!isHomie) {
					return res
						.status(403)
						.send({ error: "Can only message your homies" });
				}

				// Check if conversation already exists
				const participants = [userId, targetUserId].sort();
				let conversation = await conversationsCollection.findOne({
					participants,
				});

				if (!conversation) {
					const result = await conversationsCollection.insertOne({
						participants,
						lastMessage: null,
						unreadCount: { [userId]: 0, [targetUserId]: 0 },
						createdAt: new Date(),
						updatedAt: new Date(),
					});
					conversation = {
						_id: result.insertedId,
						participants,
						lastMessage: null,
						unreadCount: { [userId]: 0, [targetUserId]: 0 },
						createdAt: new Date(),
						updatedAt: new Date(),
					};
				}

				// Get other user info
				const otherUser = await usersCollection.findOne(
					{ _id: new ObjectId(targetUserId) },
					{ projection: { name: 1, imageUri: 1 } }
				);

				res.status(201).send({
					...conversation,
					otherUser,
				});
			} catch (error) {
				console.error("Error creating conversation:", error);
				res.status(500).send({ error: "Failed to create conversation" });
			}
		});

		// Send a message
		router.post(
			"/conversations/:conversationId/messages",
			auth,
			async (req, res) => {
				try {
					const { conversationId } = req.params;
					const { content } = req.body;
					const senderId = req.user.userId;

					if (!content || !content.trim()) {
						return res.status(400).send({ error: "Message content required" });
					}

					// Verify user is part of conversation
					const conversation = await conversationsCollection.findOne({
						_id: new ObjectId(conversationId),
						participants: senderId,
					});

					if (!conversation) {
						return res.status(404).send({ error: "Conversation not found" });
					}

					const message = {
						conversationId,
						senderId,
						content: content.trim(),
						status: "sent",
						readAt: null,
						createdAt: new Date(),
					};

					const result = await messagesCollection.insertOne(message);
					message._id = result.insertedId;

					// Update conversation
					const recipientId = conversation.participants.find(
						(p) => p !== senderId
					);
					await conversationsCollection.updateOne(
						{ _id: new ObjectId(conversationId) },
						{
							$set: {
								lastMessage: {
									content: message.content,
									senderId,
									createdAt: message.createdAt,
								},
								updatedAt: new Date(),
							},
							$inc: { [`unreadCount.${recipientId}`]: 1 },
						}
					);

					// Emit real-time event
					const io = req.app.get("io");
					if (io) {
						emitNewMessage(io, recipientId, message, {
							_id: conversationId,
							lastMessage: {
								content: message.content,
								senderId,
								createdAt: message.createdAt,
							},
						});
					}

					// TODO: Send push notification as fallback

					res.status(201).send(message);
				} catch (error) {
					console.error("Error sending message:", error);
					res.status(500).send({ error: "Failed to send message" });
				}
			}
		);

		// Mark conversation as read
		router.put("/conversations/:conversationId/read", auth, async (req, res) => {
			try {
				const { conversationId } = req.params;
				const userId = req.user.userId;

				const conversation = await conversationsCollection.findOne({
					_id: new ObjectId(conversationId),
					participants: userId,
				});

				if (!conversation) {
					return res.status(404).send({ error: "Conversation not found" });
				}

				// Reset unread count for this user
				await conversationsCollection.updateOne(
					{ _id: new ObjectId(conversationId) },
					{ $set: { [`unreadCount.${userId}`]: 0 } }
				);

				// Mark all messages from other user as read
				const otherUserId = conversation.participants.find((p) => p !== userId);
				await messagesCollection.updateMany(
					{
						conversationId,
						senderId: otherUserId,
						status: { $ne: "read" },
					},
					{
						$set: { status: "read", readAt: new Date() },
					}
				);

				// Emit read receipt
				const io = req.app.get("io");
				if (io) {
					emitMessagesRead(io, otherUserId, conversationId, userId);
				}

				res.send({ success: true });
			} catch (error) {
				console.error("Error marking conversation as read:", error);
				res.status(500).send({ error: "Failed to mark as read" });
			}
		});

		// Get total unread count across all conversations
		router.get("/unread-count", auth, async (req, res) => {
			try {
				const userId = req.user.userId;

				const conversations = await conversationsCollection
					.find({ participants: userId })
					.toArray();

				const totalUnread = conversations.reduce(
					(sum, c) => sum + (c.unreadCount?.[userId] || 0),
					0
				);

				res.send({ unreadCount: totalUnread });
			} catch (error) {
				console.error("Error fetching unread count:", error);
				res.status(500).send({ error: "Failed to fetch unread count" });
			}
		});
	})
	.catch((error) => {
		console.error("Failed to connect to MongoDB for DM routes:", error);
	});

module.exports = router;
