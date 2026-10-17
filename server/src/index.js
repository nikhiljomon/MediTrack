import 'dotenv/config';
import 'express-async-errors'; // must come before routes so async errors reach the error handler
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import mongoose from 'mongoose';

import connectDB from './config/db.js';
import auth from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import medicineRoutes from './routes/medicines.js';
import doseRoutes from './routes/doses.js';
import startReminderJob from './jobs/reminders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

// Database readiness middleware
const checkDbReady = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message: 'Database is not connected. Please ensure MongoDB is running.',
    });
  }
  next();
};

app.get('/api/health', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({
    ok: dbConnected,
    database: dbConnected ? 'connected' : 'disconnected',
  });
});

app.use('/api/auth', checkDbReady, authRoutes);
app.use('/api/medicines', checkDbReady, auth, medicineRoutes);
app.use('/api/doses', checkDbReady, auth, doseRoutes);

// In production, serve the built React app from the same server
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '../../client/dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: 'A record with that key already exists.' });
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Invalid or expired authentication session.' });
  }
  res.status(err.status || 500).json({
    message: err.message && process.env.NODE_ENV !== 'production'
      ? err.message
      : 'Something went wrong on the server. Try again.',
  });
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    startReminderJob();
  })
  .catch((err) => {
    console.error('Could not start the server:', err.message);
    process.exit(1);
  });
