import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import auth from '../middleware/auth.js';

const router = Router();

const signToken = (user) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured on the server.');
  }
  return jwt.sign({ id: user._id }, secret, { expiresIn: '30d' });
};

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, timezone: u.timezone });

router.post('/register', async (req, res) => {
  const { name, email, password, timezone } = req.body || {};
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedName || !normalizedEmail || typeof password !== 'string') {
    return res.status(400).json({ message: 'Enter your name, email and password.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Use a password with at least 6 characters.' });
  }
  if (await User.findOne({ email: normalizedEmail })) {
    return res.status(409).json({ message: 'An account with this email already exists. Sign in instead.' });
  }

  const hash = await bcrypt.hash(password, 10);
  let user;
  try {
    user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      password: hash,
      timezone: typeof timezone === 'string' && timezone ? timezone : 'Asia/Kolkata',
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'An account with this email already exists. Sign in instead.' });
    }
    throw err;
  }

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || typeof password !== 'string' || !password) {
    return res.status(400).json({ message: 'Enter your email and password.' });
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: 'The email or password is incorrect.' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
