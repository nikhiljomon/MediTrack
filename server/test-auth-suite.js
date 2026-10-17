import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import connectDB from './src/config/db.js';
import auth from './src/middleware/auth.js';
import authRoutes from './src/routes/auth.js';
import medicineRoutes from './src/routes/medicines.js';
import doseRoutes from './src/routes/doses.js';
import User from './src/models/User.js';

const app = express();
app.use(cors());
app.use(express.json());

const checkDbReady = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Database is not connected. Please ensure MongoDB is running.' });
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

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: 'A record with that key already exists.' });
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Invalid or expired authentication session.' });
  }
  res.status(err.status || 500).json({ message: err.message || 'Something went wrong.' });
});

async function runTests() {
  console.log('--- Starting Authentication Test Suite ---');
  await connectDB();

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
    // 1. Health check
    {
      const res = await fetch(`${baseUrl}/api/health`);
      const data = await res.json();
      assert(res.status === 200 && data.ok === true && data.database === 'connected', 'Health check returns database connected');
    }

    // 2. Missing name
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      });
      const data = await res.json();
      assert(res.status === 400 && data.message.includes('name'), 'Registration rejected when name is missing');
    }

    // 3. Missing email
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, password: testPassword }),
      });
      const data = await res.json();
      assert(res.status === 400 && data.message.includes('email'), 'Registration rejected when email is missing');
    }

    // 4. Missing password
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: testEmail }),
      });
      const data = await res.json();
      assert(res.status === 400 && data.message.includes('password'), 'Registration rejected when password is missing');
    }

    // 5. Invalid email format
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: 'invalid-email', password: testPassword }),
      });
      const data = await res.json();
      assert(res.status === 400 && data.message.includes('valid email'), 'Registration rejected on invalid email format');
    }

    // 6. Short password (< 6 chars)
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: testEmail, password: '123' }),
      });
      const data = await res.json();
      assert(res.status === 400 && data.message.includes('6 characters'), 'Registration rejected when password < 6 characters');
    }

    // 7. Successful registration
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
        data.user.email === testEmail &&
        data.user.name === testName &&
        !data.user.password &&
        !data.password,
        'Successful registration returns token and user without password'
      );
    }

    // 8. Duplicate email registration
    {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Another Name', email: testEmail, password: 'AnotherPassword123' }),
      });
      const data = await res.json();
      assert(res.status === 409 && data.message.includes('already exists'), 'Duplicate registration returns 409 conflict');
    }

    // 9. Login with missing fields
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });
      assert(res.status === 400, 'Login with missing password returns 400');
    }

    // 10. Login with unknown email
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent_user@example.com', password: testPassword }),
      });
      const data = await res.json();
      assert(res.status === 401 && data.message.includes('incorrect'), 'Login with unknown email returns 401');
    }

    // 11. Login with incorrect password
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: 'WrongPassword' }),
      });
      const data = await res.json();
      assert(res.status === 401 && data.message.includes('incorrect'), 'Login with incorrect password returns 401');
    }

    // 12. Successful login
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail.toUpperCase(), password: testPassword }), // test case-insensitivity
      });
      const data = await res.json();
      assert(
        res.status === 200 &&
        typeof data.token === 'string' &&
        data.user &&
        data.user.email === testEmail,
        'Successful login returns 200 with token and user (normalized email)'
      );
    }

    // 13. Access /api/auth/me with valid token
    {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      assert(
        res.status === 200 &&
        data.user &&
        data.user.email === testEmail,
        'Access /api/auth/me with valid token succeeds (session persistence)'
      );
    }

    // 14. Access /api/auth/me without token
    {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      assert(res.status === 401, 'Access /api/auth/me without token returns 401');
    }

    // 15. Access protected route /api/medicines with token
    {
      const res = await fetch(`${baseUrl}/api/medicines`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      assert(res.status === 200, 'Access protected /api/medicines with token returns 200');
    }

    // 16. Access protected route /api/medicines without token
    {
      const res = await fetch(`${baseUrl}/api/medicines`);
      assert(res.status === 401, 'Access protected /api/medicines without token returns 401');
    }

  } finally {
    // Cleanup test user
    await User.deleteOne({ email: testEmail });
    server.close();
    await mongoose.disconnect();
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
