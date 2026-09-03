const express = require('express');
const Joi = require('joi');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const bcrypt = require('bcrypt');
const validateWith = require('../middleware/validation');
const { PROVIDERS, getAuthProvider, providerMismatch } = require('../services/authProvider');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const schema = {
  email: Joi.string().email().required(),
  password: Joi.string().required().min(5),
};

module.exports = (db) => {
  const router = express.Router();
  const usersCollection = db.collection('users');

  router.post('/', validateWith(schema), async (req, res) => {
    const { email, password } = req.body;

    try {
      const userExists = await usersCollection.findOne({ email: email });
      if (!userExists) {
        return res.status(400).send({ error: 'Invalid email or password.' });
      }

      // Check if user has a password (SSO users might not have one)
      if (!userExists.password) {
        const provider = getAuthProvider(userExists);
        return res.status(409).send(
          provider
            ? providerMismatch(provider)
            : {
                error: 'We could not verify this account’s sign-in method.',
                code: 'AUTH_RECOVERY_REQUIRED',
                recoveryPath: '/forgot-password',
              },
        );
      }

      // Compare the provided password with the hashed password in the database
      const passwordMatch = await bcrypt.compare(password, userExists.password);
      if (!passwordMatch) {
        return res.status(400).send({ error: 'Invalid email or password.' });
      }

      const token = jwt.sign(
        {
          userId: userExists._id,
          name: userExists.name,
          email: userExists.email,
          imageUri: userExists.imageUri,
          role: userExists.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: '30d' },
      );
      res.send({ token });
    } catch (error) {
      console.error(error);
      return res.status(400).send({ error: 'Database Error.' });
    }
  });
  // Google SSO auth
  router.post('/google-auth', async (req, res) => {
    const { tokenId } = req.body;
    console.log('request body to google auth == ', req.body);
    try {
      // Verify the token with Google
      // Accept tokens from web, iOS, and Android clients
      const ticket = await googleClient.verifyIdToken({
        idToken: tokenId,
        audience: [
          process.env.GOOGLE_CLIENT_ID, // Web
          process.env.GOOGLE_IOS_CLIENT_ID, // iOS
          process.env.GOOGLE_ANDROID_CLIENT_ID, // Android
        ].filter(Boolean),
      });

      const payload = ticket.getPayload();
      const { email, name, picture } = payload;

      let user = await usersCollection.findOne({ email: email });
      if (!user) {
        // Create new user if they don't exist
        const newUser = {
          name: name,
          email: email,
          imageUri: picture,
          isGoogleSSO: true,
          network: true,
          homies: [],
          homieRequests: { sent: [], received: [] },
          createdAt: new Date(),
        };
        const result = await usersCollection.insertOne(newUser);
        //console.log("New user inserted via google auth: ", result);
        user = {
          _id: result.insertedId,
          ...newUser,
        };
      } else {
        const existingProvider = getAuthProvider(user);
        if (existingProvider && existingProvider !== PROVIDERS.GOOGLE) {
          return res.status(409).send(providerMismatch(existingProvider));
        }
        // Existing user: only BACKFILL SSO fields we don't already have — never
        // clobber a name or avatar the user has customized in the app. Previously
        // this $set overwrote imageUri (and name) on every login, so a custom
        // profile photo reverted to the Google avatar each time you signed in.
        const backfill = {};
        if (!user.name) backfill.name = name;
        if (!user.imageUri) backfill.imageUri = picture;
        if (Object.keys(backfill).length > 0) {
          await usersCollection.updateOne({ _id: user._id }, { $set: backfill });
          // keep the in-memory user (used to sign the JWT below) in sync
          Object.assign(user, backfill);
        }
      }

      const token = jwt.sign(
        {
          userId: user._id,
          name: user.name,
          email: user.email,
          imageUri: user.imageUri,
          role: user.role ? user.role : null,
        },
        process.env.JWT_SECRET,
        { expiresIn: '30d' },
      );
      res.send({ token });
    } catch (error) {
      console.error('Error during Google authentication:', error);
      return res.status(400).send({ error: 'Invalid Google ID token.' });
    }
  });

  // Apple SSO auth
  router.post('/apple-auth', async (req, res) => {
    const { identityToken, fullName, email } = req.body;
    console.log('request body to apple auth == ', req.body);
    try {
      // Verify the token with Apple — accept both iOS bundle ID and web Services ID
      const applePayload = await appleSignin.verifyIdToken(identityToken, {
        audience: [process.env.APPLE_CLIENT_ID, process.env.APPLE_WEB_SERVICE_ID].filter(Boolean),
        ignoreExpiration: false,
      });

      const appleUserId = applePayload.sub;
      // Apple only provides email on first sign-in, use from token if available
      const userEmail = email || applePayload.email;

      let user = await usersCollection.findOne({
        $or: [{ appleUserId: appleUserId }, { email: userEmail }],
      });

      if (!user) {
        // Create new user if they don't exist
        const newUser = {
          name: fullName || 'Apple User',
          email: userEmail,
          appleUserId: appleUserId,
          network: true,
          homies: [],
          homieRequests: { sent: [], received: [] },
          createdAt: new Date(),
        };
        const result = await usersCollection.insertOne(newUser);
        user = {
          _id: result.insertedId,
          ...newUser,
        };
      } else if (!user.appleUserId) {
        const existingProvider = getAuthProvider(user);
        if (existingProvider && existingProvider !== PROVIDERS.APPLE) {
          return res.status(409).send(providerMismatch(existingProvider));
        }
        await usersCollection.updateOne({ _id: user._id }, { $set: { appleUserId: appleUserId } });
      }

      const token = jwt.sign(
        {
          userId: user._id,
          name: user.name,
          email: user.email,
          imageUri: user.imageUri,
          role: user.role ? user.role : null,
        },
        process.env.JWT_SECRET,
        { expiresIn: '30d' },
      );
      res.send({ token });
    } catch (error) {
      console.error('Error during Apple authentication:', error);
      return res.status(400).send({ error: 'Invalid Apple identity token.' });
    }
  });

  return router;
};
