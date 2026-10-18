import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import connectDB from './src/config/db.js';
import auth from './src/middleware/auth.js';
import authRoutes from './src/routes/auth.js';
import medicineRoutes from './src/routes/medicines.js';
import doseRoutes from './src/routes/doses.js';
import User from './src/models/User.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const DEFAULT_TEST_SECRET = 'test-jwt-secret-key-at-least-32-chars-long';
process.env.JWT_SECRET = process.env.JWT_SECRET || DEFAULT_TEST_SECRET;

const app = express();
app.use(cors());
app.use(express.json());

let simulateDbDisconnected = false;
let simulateDbError = false;

const checkDbReady = (req, res, next) => {
  if (simulateDbDisconnected || mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Database is not connected. Please ensure MongoDB is running.' });
  }
  next();
};

app.get('/api/health', (req, res) => {
  const isReady = !simulateDbDisconnected && mongoose.connection.readyState === 1;
  res.status(isReady ? 200 : 503).json({
    ok: isReady,
    database: isReady ? 'connected' : 'disconnected',
  });
});

app.use('/api/auth', checkDbReady, authRoutes);
app.use('/api/medicines', checkDbReady, auth, medicineRoutes);
app.use('/api/doses', checkDbReady, auth, doseRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const safeMessage = typeof err.message === 'string'
    ? err.message.replace(/mongodb(\+srv)?:\/\/([^:]+):([^@]+)@/g, 'mongodb$1://$2:***@')
    : 'Unknown error';

  console.error('Unhandled server error:', {
    name: err.name,
    message: safeMessage,
    code: err.code,
    status: err.status,
  });

  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: 'An account with this email already exists.' });
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Invalid or expired authentication session.' });
  }
  if (
    err.name === 'MongooseServerSelectionError' ||
    err.name === 'MongoServerSelectionError' ||
    err.name === 'MongoNetworkError' ||
    err.name === 'MongoTimeoutError' ||
    err.name === 'MongoNetworkTimeoutError' ||
    (err.message && (err.message.includes('buffering timed out') || err.message.includes('ECONNREFUSED')))
  ) {
    return res.status(503).json({
      message: 'Database is unavailable. Please ensure MongoDB is running.',
    });
  }

  res.status(err.status || 500).json({
    message: err.status && err.status < 500
      ? err.message
      : 'Something went wrong on the server. Try again.',
  });
});

async function runTests() {
  console.log('--- Starting Authentication Test Suite ---');
  let liveDb = false;

  try {
    await connectDB();
    liveDb = true;
    console.log('✓ Connected to live MongoDB instance.');
  } catch (err) {
    console.log('Notice: Live MongoDB not accessible locally. Setting up in-memory simulation for tests.');
    // Set readyState to 1 so checkDbReady passes during mock tests
    Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true, writable: true });

    const mockUsers = new Map();
    const origFindOne = User.findOne.bind(User);
    const origCreate = User.create.bind(User);
    const origFindById = User.findById.bind(User);

    User.findOne = async function (filter) {
      if (simulateDbError) {
        const error = new Error('Could not connect to any servers in your MongoDB Atlas cluster.');
        error.name = 'MongooseServerSelectionError';
        throw error;
      }
      if (filter && filter.email) {
        return mockUsers.get(filter.email.toLowerCase()) || null;
      }
      return null;
    };

    User.create = async function (data) {
      if (simulateDbError) {
        const error = new Error('Could not connect to any servers in your MongoDB Atlas cluster.');
        error.name = 'MongooseServerSelectionError';
        throw error;
      }
      const email = (data.email || '').toLowerCase();
      if (mockUsers.has(email)) {
        const err = new Error('Duplicate key');
        err.code = 11000;
        throw err;
      }
      const user = {
        _id: new mongoose.Types.ObjectId(),
        name: data.name,
        email,
        password: data.password,
        timezone: data.timezone || 'Asia/Kolkata',
      };
      mockUsers.set(email, user);
      return user;
    };

    User.findById = function (id) {
      return {
        select: (fields) => {
          for (const u of mockUsers.values()) {
            if (u._id.toString() === id.toString()) {
              const res = { ...u };
              if (fields && fields.includes('-password')) delete res.password;
              return res;
            }
          }
          return null;
        },
      };
    };
  }

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Test server running on ${baseUrl}`);

  const testEmail = `testuser_${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  const testName = 'Test User';
  let authToken = null;

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}`);
      failed++;
    }
  }

  try {
    // 1. Health check (connected)
    {
      const res = await fetch(`${baseUrl}/api/health`);
      const data = await res.json();
      assert(res.status === 200 && data.ok === true && data.database === 'connected', 'Health check returns database connected');
    }

    // 2. Database failure test: Connection down returns 503
    {
      simulateDbDisconnected = true;
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
      });
      const data = await res.json();
      simulateDbDisconnected = false;
      assert(
        res.status === 503 && data.message.includes('Database is not connected'),
        'Database connection failure returns 503 Service Unavailable'
      );
    }

    // 3. Database failure test: Query-level DB error returns 503
    {
      simulateDbError = true;
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
      });
      const data = await res.json();
      simulateDbError = false;
      assert(
        res.status === 503 && data.message.includes('Database is unavailable'),
        'Database query error returns 503 Service Unavailable'
      );
    }

    // 4. Server configuration error test: Missing JWT_SECRET returns 500 without creating user
    {
      const savedSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Config Test User', email: 'config_test@example.com', password: testPassword }),
      });
      const data = await res.json();
      process.env.JWT_SECRET = savedSecret;

      assert(
        res.status === 500 && data.message.includes('Something went wrong'),
        'Missing JWT_SECRET returns 500 without crashing or corrupting data'
      );
    }

    // 5. Missing name returns 400
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      });
      const data = await res.json();
      assert(res.status === 400 && data.message.includes('name'), 'Registration rejected when name is missing');
    }

    // 6. Missing email returns 400
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, password: testPassword }),
      });
      const data = await res.json();
      assert(res.status === 400 && data.message.includes('email'), 'Registration rejected when email is missing');
    }

    // 7. Missing password returns 400
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: testEmail }),
      });
      const data = await res.json();
      assert(res.status === 400 && data.message.includes('password'), 'Registration rejected when password is missing');
    }

    // 8. Invalid email format returns 400
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: 'invalid-email', password: testPassword }),
      });
      const data = await res.json();
      assert(res.status === 400 && data.message.includes('valid email'), 'Registration rejected on invalid email format');
    }

    // 9. Short password (< 6 chars) returns 400
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: testEmail, password: '123' }),
      });
      const data = await res.json();
      assert(res.status === 400 && data.message.includes('6 characters'), 'Registration rejected when password < 6 characters');
    }

    // 10. Successful registration returns 201 with token and user object
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
      });
      const data = await res.json();
      authToken = data.token;
      assert(
        res.status === 201 &&
        typeof data.token === 'string' &&
        data.user &&
        data.user.email === testEmail.toLowerCase() &&
        data.user.name === testName &&
        !data.user.password &&
        !data.password,
        'Successful registration returns 201 with token and user without password'
      );
    }

    // 11. Duplicate email registration returns 409 conflict
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Another Name', email: testEmail, password: 'AnotherPassword123' }),
      });
      const data = await res.json();
      assert(res.status === 409 && data.message.includes('already exists'), 'Duplicate registration returns 409 conflict');
    }

    // 12. Login with missing fields returns 400
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });
      assert(res.status === 400, 'Login with missing password returns 400');
    }

    // 13. Login with unknown email returns 401
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent_user@example.com', password: testPassword }),
      });
      const data = await res.json();
      assert(res.status === 401 && data.message.includes('incorrect'), 'Login with unknown email returns 401');
    }

    // 14. Login with incorrect password returns 401
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: 'WrongPassword' }),
      });
      const data = await res.json();
      assert(res.status === 401 && data.message.includes('incorrect'), 'Login with incorrect password returns 401');
    }

    // 15. Successful login returns 200 with token
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail.toUpperCase(), password: testPassword }),
      });
      const data = await res.json();
      assert(
        res.status === 200 &&
        typeof data.token === 'string' &&
        data.user &&
        data.user.email === testEmail.toLowerCase(),
        'Successful login returns 200 with token and user'
      );
    }

    // 16. Access /api/auth/me with valid token returns 200
    {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      assert(
        res.status === 200 &&
        data.user &&
        data.user.email === testEmail.toLowerCase(),
        'Access /api/auth/me with valid token succeeds'
      );
    }

    // 17. Access /api/auth/me without token returns 401
    {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      assert(res.status === 401, 'Access /api/auth/me without token returns 401');
    }

  } finally {
    if (liveDb) {
      await User.deleteOne({ email: testEmail.toLowerCase() });
      await mongoose.disconnect();
    }
    server.close();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
