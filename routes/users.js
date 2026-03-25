const express = require('express');
const router = express.Router();
const Joi = require('joi');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const _usersStore = require('../store/users');
const validateWith = require('../middleware/validation');
const authAccountOrAdmin = require('../middleware/authAccountOrAdmin');
const auth = require('../middleware/auth');
const { MongoClient } = require('mongodb');
const ObjectId = require('mongodb').ObjectId;
const connectionString = process.env.ATLAS_URI;

// Email transporter for password reset
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const schema = {
  name: Joi.string().required().min(2),
  email: Joi.string().email().required(),
  password: Joi.string().required().min(5),
  isGoogleSSO: Joi.boolean().optional(),
  // New rider profile fields
  sports: Joi.array().items(Joi.string()).optional(),
  riderProfile: Joi.object({
    nickname: Joi.string().allow('').optional(),
    age: Joi.alternatives().try(Joi.string(), Joi.number()).allow('').optional(),
    height: Joi.string().allow('').optional(),
    weight: Joi.string().allow('').optional(),
    nationality: Joi.string().allow('').optional(),
    riderStyle: Joi.string().allow('').optional(),
    alternateSport: Joi.string().allow('').optional(),
    motto: Joi.string().allow('').optional(),
    dreamDate: Joi.string().allow('').optional(),
    favoriteMovie: Joi.string().allow('').optional(),
    favoriteReading: Joi.string().allow('').optional(),
    favoriteMusic: Joi.string().allow('').optional(),
    favoriteCourse: Joi.string().allow('').optional(),
    sickestTrick: Joi.string().allow('').optional(),
    greatestStrength: Joi.string().allow('').optional(),
    greatestWeakness: Joi.string().allow('').optional(),
    otherHobbies: Joi.string().allow('').optional(),
    avatarType: Joi.string().valid('icon', 'upload').optional(),
    avatarIcon: Joi.object({
      id: Joi.string(),
      emoji: Joi.string(),
      bg: Joi.string(),
    }).optional(),
  }).optional(),
};

MongoClient.connect(connectionString, { useUnifiedTopology: true })
  .then((client) => {
    const db = client.db('TrickList2');
    const usersCollection = db.collection('users');

    router.post('/', validateWith(schema), async (req, res) => {
      const { name, email, password, isGoogleSSO, sports, riderProfile } = req.body;
      let userBool = false;

      try {
        const userExists = await usersCollection.findOne({ email: email });
        if (userExists) {
          userBool = true;
          return res.status(400).send({ error: 'A user with the given email already exists.' });
        }
      } catch (error) {
        console.log(error);
        return res.status(500).send({ error: 'Internal Server Error' });
      }

      if (userBool === false) {
        try {
          // If it's not a Google SSO user, hash the password
          const hashedPassword = isGoogleSSO ? password : await bcrypt.hash(password, 10);
          const user = {
            name,
            email,
            password: hashedPassword,
            isGoogleSSO: isGoogleSSO || false,
            // New rider profile fields
            sports: sports || [],
            riderProfile: riderProfile || {},
            // Default to discoverable so users can find each other
            network: true,
            createdAt: new Date(),
          };

          await usersCollection.insertOne(user);
          // Don't send password back
          const { password: _, ...userResponse } = user;
        // Auto-add Kaori as homie for new users
        try {
          const KAORI_BOT_ID = '69c15e55c7ebe2c6884f1267';
          const newUserId = result.insertedId.toString();
          await usersCollection.updateOne(
            { _id: result.insertedId },
            { $addToSet: { homies: KAORI_BOT_ID } }
          );
          await usersCollection.updateOne(
            { _id: new ObjectId(KAORI_BOT_ID) },
            { $addToSet: { homies: newUserId } }
          );
        } catch (kaoriErr) {
          console.error('Auto-add Kaori error (non-fatal):', kaoriErr.message);
        }

          res.status(201).send(userResponse);
        } catch (error) {
          console.log(error);
          res.status(500).send({ error: 'Internal Server Error' });
        }
      }
    });

    router.get('/', async (req, res) => {
      try {
        console.log(req.query.email);
        const userExists2 = await usersCollection.findOne({
          email: req.query.email,
        });
        res.status(200).send(userExists2);
      } catch (_error) {
        res.status(400).send('Error Getting User');
      }
    });

    router.get('/all', async (_req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.status(200).send(users);
      } catch (error) {
        console.error(error);
        res.status(500).send('Error getting users');
      }
    });

    router.delete('/:id', authAccountOrAdmin(), async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: 'Invalid ID' });
      }

      try {
        const userToDelete = await usersCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!userToDelete) {
          return res.status(404).send({ error: 'User not found' });
        }

        const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(500).send({ error: 'Failed to delete user' });
        }

        res.send({ message: 'User deleted successfully' });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Forgot Password - sends reset email
    router.post('/forgot-password', async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res.status(400).send({ error: 'Email is required' });
      }

      try {
        const user = await usersCollection.findOne({ email: email.toLowerCase() });

        if (!user) {
          // Don't reveal if user exists or not for security
          return res
            .status(200)
            .send({ message: 'If an account with that email exists, a reset link has been sent.' });
        }

        // Check if user signed up with Google SSO
        if (user.isGoogleSSO) {
          return res
            .status(400)
            .send({ error: 'This account uses Google Sign-In. Please log in with Google.' });
        }

        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now

        // Save token to user document
        await usersCollection.updateOne(
          { _id: user._id },
          {
            $set: {
              resetToken: resetToken,
              resetTokenExpiry: resetTokenExpiry,
            },
          },
        );

        // Send reset email
        const resetUrl = `${process.env.FRONTEND_URL || 'https://thetrickbook.com'}/reset-password?token=${resetToken}`;

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: email,
          subject: 'TrickBook Password Reset',
          html: `
						<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
							<h2 style="color: #333;">Reset Your Password</h2>
							<p>Hi ${user.name || 'there'},</p>
							<p>You requested to reset your password for your TrickBook account.</p>
							<p>Click the button below to reset your password. This link will expire in 1 hour.</p>
							<a href="${resetUrl}" style="display: inline-block; background-color: #4A90D9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 16px 0;">Reset Password</a>
							<p>If you didn't request this, you can safely ignore this email.</p>
							<p>- The TrickBook Team</p>
						</div>
					`,
        };

        await transporter.sendMail(mailOptions);

        res
          .status(200)
          .send({ message: 'If an account with that email exists, a reset link has been sent.' });
      } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).send({ error: 'Failed to process request' });
      }
    });

    // Reset Password - validates token and updates password
    router.post('/reset-password', async (req, res) => {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).send({ error: 'Token and new password are required' });
      }

      if (newPassword.length < 5) {
        return res.status(400).send({ error: 'Password must be at least 5 characters' });
      }

      try {
        const user = await usersCollection.findOne({
          resetToken: token,
          resetTokenExpiry: { $gt: Date.now() },
        });

        if (!user) {
          return res.status(400).send({ error: 'Invalid or expired reset token' });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password and clear reset token
        await usersCollection.updateOne(
          { _id: user._id },
          {
            $set: { password: hashedPassword },
            $unset: { resetToken: '', resetTokenExpiry: '' },
          },
        );

        res.status(200).send({
          message: 'Password reset successful. You can now log in with your new password.',
        });
      } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).send({ error: 'Failed to reset password' });
      }
    });

    // =============================================
    // HOMIES / NETWORK ENDPOINTS
    // =============================================

    // Get current user's network status
    router.get('/network-status', auth, async (req, res) => {
      try {
        const user = await usersCollection.findOne(
          { _id: new ObjectId(req.user.userId) },
          { projection: { network: 1, homies: 1, homieRequests: 1 } },
        );

        if (!user) {
          return res.status(404).send({ error: 'User not found' });
        }

        res.send({
          network: user.network || false,
          homiesCount: (user.homies || []).length,
          pendingRequestsCount: (user.homieRequests?.received || []).length,
        });
      } catch (error) {
        console.error('Error fetching network status:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Toggle network visibility (discoverable)
    router.put('/:id/network', auth, async (req, res) => {
      const { id } = req.params;
      const { network } = req.body;

      // Verify user is updating their own account
      if (req.user.userId !== id) {
        return res.status(403).send({ error: 'Access denied' });
      }

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: 'Invalid ID' });
      }

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { network: Boolean(network) } },
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ error: 'User not found' });
        }

        res.send({ message: 'Network status updated', network: Boolean(network) });
      } catch (error) {
        console.error('Error updating network status:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Get discoverable users — supports ?q= for name search
    router.get('/discoverable', auth, async (req, res) => {
      try {
        const currentUserId = new ObjectId(req.user.userId);
        const searchQuery = req.query.q ? req.query.q.trim() : '';

        // Get current user's homies and sent requests to exclude them
        const currentUser = await usersCollection.findOne(
          { _id: currentUserId },
          { projection: { homies: 1, homieRequests: 1 } },
        );

        const excludeIds = [currentUserId];

        // Exclude existing homies
        if (currentUser?.homies) {
          for (const id of currentUser.homies) {
            excludeIds.push(new ObjectId(id));
          }
        }

        // Exclude users we've already sent requests to
        if (currentUser?.homieRequests?.sent) {
          for (const id of currentUser.homieRequests.sent) {
            excludeIds.push(new ObjectId(id));
          }
        }

        // Build query filter
        const filter = {
          _id: { $nin: excludeIds },
          isBot: { $ne: true },
        };

        if (searchQuery) {
          // When searching, search ALL users by name (case-insensitive, partial match)
          filter.name = { $regex: searchQuery, $options: 'i' };
        }

        // Pagination: ?page=1&limit=20 (defaults: page 1, limit 20)
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [discoverableUsers, totalCount] = await Promise.all([
          usersCollection
            .find(filter)
            .project({ name: 1, imageUri: 1, bio: 1, sports: 1 })
            .skip(skip)
            .limit(limit)
            .toArray(),
          usersCollection.countDocuments(filter)
        ]);

        res.send({
          users: discoverableUsers,
          pagination: {
            page,
            limit,
            total: totalCount,
            pages: Math.ceil(totalCount / limit),
            hasMore: page * limit < totalCount,
          }
        });
      } catch (error) {
        console.error('Error fetching discoverable users:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Send homie request
    router.post('/:id/homie-request', auth, async (req, res) => {
      const targetId = req.params.id;
      const senderId = req.user.userId;

      if (!ObjectId.isValid(targetId)) {
        return res.status(400).send({ error: 'Invalid ID' });
      }

      if (targetId === senderId) {
        return res.status(400).send({ error: 'Cannot send request to yourself' });
      }

      try {
        const targetUser = await usersCollection.findOne({ _id: new ObjectId(targetId) });

        if (!targetUser) {
          return res.status(404).send({ error: 'User not found' });
        }

        // Skip network check for bots
        if (!targetUser.network && !targetUser.isBot) {
          return res.status(400).send({ error: 'User is not accepting homie requests' });
        }

        // Check if already homies
        if (targetUser.homies?.includes(senderId)) {
          return res.status(400).send({ error: 'Already homies' });
        }

        // Check if request already sent
        if (targetUser.homieRequests?.received?.some((r) => r.from === senderId)) {
          return res.status(400).send({ error: 'Request already sent' });
        }

        // Add to target's received requests
        await usersCollection.updateOne(
          { _id: new ObjectId(targetId) },
          {
            $push: {
              'homieRequests.received': {
                from: senderId,
                sentAt: new Date(),
              },
            },
          },
        );

        // Add to sender's sent requests
        await usersCollection.updateOne(
          { _id: new ObjectId(senderId) },
          {
            $push: {
              'homieRequests.sent': targetId,
            },
          },
        );

        // Auto-accept for bot users
        if (targetUser.isBot) {
          const targetUserId = targetId;
          // Add each other as homies immediately
          await usersCollection.updateOne(
            { _id: new ObjectId(targetUserId) },
            { 
              $addToSet: { homies: senderId },
              $pull: { 'homieRequests.received': { from: senderId } }
            }
          );
          await usersCollection.updateOne(
            { _id: new ObjectId(senderId) },
            { 
              $addToSet: { homies: targetUserId },
              $pull: { 'homieRequests.sent': targetUserId }
            }
          );
          return res.send({ message: 'You are now homies!', autoAccepted: true });
        }

        res.send({ message: 'Homie request sent' });
      } catch (error) {
        console.error('Error sending homie request:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Accept homie request
    router.post('/:id/accept-homie', auth, async (req, res) => {
      const requesterId = req.params.id; // The person who sent the request
      const currentUserId = req.user.userId;

      if (!ObjectId.isValid(requesterId)) {
        return res.status(400).send({ error: 'Invalid ID' });
      }

      try {
        // Verify the request exists
        const currentUser = await usersCollection.findOne({
          _id: new ObjectId(currentUserId),
          'homieRequests.received.from': requesterId,
        });

        if (!currentUser) {
          return res.status(404).send({ error: 'Request not found' });
        }

        // Add each other as homies
        await usersCollection.updateOne(
          { _id: new ObjectId(currentUserId) },
          {
            $push: { homies: requesterId },
            $pull: { 'homieRequests.received': { from: requesterId } },
          },
        );

        await usersCollection.updateOne(
          { _id: new ObjectId(requesterId) },
          {
            $push: { homies: currentUserId },
            $pull: { 'homieRequests.sent': currentUserId },
          },
        );

        res.send({ message: 'Homie request accepted' });
      } catch (error) {
        console.error('Error accepting homie request:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Reject homie request
    router.post('/:id/reject-homie', auth, async (req, res) => {
      const requesterId = req.params.id;
      const currentUserId = req.user.userId;

      if (!ObjectId.isValid(requesterId)) {
        return res.status(400).send({ error: 'Invalid ID' });
      }

      try {
        // Remove from current user's received requests
        await usersCollection.updateOne(
          { _id: new ObjectId(currentUserId) },
          {
            $pull: { 'homieRequests.received': { from: requesterId } },
          },
        );

        // Remove from requester's sent requests
        await usersCollection.updateOne(
          { _id: new ObjectId(requesterId) },
          {
            $pull: { 'homieRequests.sent': currentUserId },
          },
        );

        res.send({ message: 'Homie request rejected' });
      } catch (error) {
        console.error('Error rejecting homie request:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Get my homies list
    router.get('/homies', auth, async (req, res) => {
      try {
        const currentUser = await usersCollection.findOne(
          { _id: new ObjectId(req.user.userId) },
          { projection: { homies: 1 } },
        );

        if (!currentUser || !currentUser.homies || currentUser.homies.length === 0) {
          return res.send([]);
        }

        // Get homie details
        const homieIds = currentUser.homies.map((id) => new ObjectId(id));
        const homies = await usersCollection
          .find({ _id: { $in: homieIds } })
          .project({ name: 1, imageUri: 1 })
          .toArray();

        res.send(homies);
      } catch (error) {
        console.error('Error fetching homies:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Get pending homie requests
    router.get('/homie-requests', auth, async (req, res) => {
      try {
        const currentUser = await usersCollection.findOne(
          { _id: new ObjectId(req.user.userId) },
          { projection: { homieRequests: 1 } },
        );

        if (!currentUser) {
          return res.status(404).send({ error: 'User not found' });
        }

        const received = currentUser.homieRequests?.received || [];
        const sent = currentUser.homieRequests?.sent || [];

        // Get user details for received requests
        let receivedDetails = [];
        if (received.length > 0) {
          const receivedIds = received.map((r) => new ObjectId(r.from));
          const receivedUsers = await usersCollection
            .find({ _id: { $in: receivedIds } })
            .project({ name: 1, imageUri: 1 })
            .toArray();

          receivedDetails = received.map((r) => {
            const user = receivedUsers.find((u) => u._id.toString() === r.from);
            return {
              ...r,
              user: user || { name: 'Unknown User' },
            };
          });
        }

        // Get user details for sent requests
        let sentDetails = [];
        if (sent.length > 0) {
          const sentIds = sent.map((id) => new ObjectId(id));
          sentDetails = await usersCollection
            .find({ _id: { $in: sentIds } })
            .project({ name: 1, imageUri: 1 })
            .toArray();
        }

        res.send({
          received: receivedDetails,
          sent: sentDetails,
        });
      } catch (error) {
        console.error('Error fetching homie requests:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Remove a homie
    router.delete('/homie/:id', auth, async (req, res) => {
      const homieId = req.params.id;
      const currentUserId = req.user.userId;

      if (!ObjectId.isValid(homieId)) {
        return res.status(400).send({ error: 'Invalid ID' });
      }

      try {
        // Remove from both users' homies arrays
        await usersCollection.updateOne(
          { _id: new ObjectId(currentUserId) },
          { $pull: { homies: homieId } },
        );

        await usersCollection.updateOne(
          { _id: new ObjectId(homieId) },
          { $pull: { homies: currentUserId } },
        );

        res.send({ message: 'Homie removed' });
      } catch (error) {
        console.error('Error removing homie:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Check homie status with another user
    router.get('/homie-status/:targetId', auth, async (req, res) => {
      const { targetId } = req.params;
      const currentUserId = req.user.userId;

      if (!ObjectId.isValid(targetId)) {
        return res.status(400).send({ error: 'Invalid user ID' });
      }

      try {
        const currentUser = await usersCollection.findOne(
          { _id: new ObjectId(currentUserId) },
          { projection: { homies: 1, homieRequests: 1 } },
        );

        if (!currentUser) {
          return res.status(404).send({ error: 'User not found' });
        }

        // Check if already homies
        if (currentUser.homies?.includes(targetId)) {
          return res.send({ status: 'homies' });
        }

        // Check if request pending (we sent to them)
        if (currentUser.homieRequests?.sent?.includes(targetId)) {
          return res.send({ status: 'pending' });
        }

        // Check if we received a request from them
        const receivedRequest = currentUser.homieRequests?.received?.find(
          (r) => r.from === targetId,
        );
        if (receivedRequest) {
          return res.send({ status: 'received' });
        }

        res.send({ status: 'none' });
      } catch (error) {
        console.error('Error checking homie status:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });
  })
  .catch((error) => {
    console.log(error);
  }); // end mongoClient

module.exports = router;
