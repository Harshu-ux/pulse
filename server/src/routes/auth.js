'use strict';

const express = require('express');
const { z } = require('zod');
const User = require('../models/User');
const { hashPassword, checkPassword, signToken } = require('../lib/auth');
const { requireUser } = require('../middleware/requireUser');

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, 'password must be at least 8 characters').max(200),
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

const LOGIN_WINDOW_SEC = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 10;

const publicUser = (u) => ({ id: String(u._id), email: u.email, name: u.name });

function authRouter({ redis, config }) {
  const router = express.Router();

  router.post('/register', async (req, res, next) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { name, email, password } = parsed.data;
    try {
      const user = await User.create({ name, email, passwordHash: await hashPassword(password) });
      return res.status(201).json({ token: signToken(user, config), user: publicUser(user) });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'an account with this email already exists' });
      return next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'email and password are required' });
    const { email, password } = parsed.data;

    try {
      // Brute-force protection: limit attempts per email + IP.
      const key = `pulse:login:${email}:${req.ip}`;
      const [[, attempts]] = await redis.multi().incr(key).expire(key, LOGIN_WINDOW_SEC, 'NX').exec();
      if (attempts > LOGIN_MAX_ATTEMPTS) {
        return res.status(429).json({ error: 'too many attempts, try again in 15 minutes' });
      }

      const user = await User.findOne({ email }).lean();
      const ok = await checkPassword(password, user && user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'incorrect email or password' });

      await redis.del(key);
      return res.json({ token: signToken(user, config), user: publicUser(user) });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/me', requireUser(config), async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id).lean();
      if (!user) return res.status(401).json({ error: 'account no longer exists' });
      return res.json({ user: publicUser(user) });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { authRouter };
