# Medicine Reminder: Full-Stack App (React + Node/Express + MongoDB)

A complete working app where people sign in, add their medicines, get a daily checklist, mark doses as taken or skipped, receive reminders, and review their history.

## What you get

| Feature | How it works |
|---|---|
| Sign up / sign in | JWT tokens, bcrypt-hashed passwords |
| Add medicines | Name, dosage, form, multiple times a day, chosen weekdays, start and end date, stock count |
| Today's checklist | Doses appear automatically from each medicine's schedule. Taken, Skip, Undo and Snooze buttons |
| Browser notifications | Pop up when a dose is due (the app must be open in a tab or installed as a PWA) |
| Email reminders | A background job checks every minute and emails users when a dose is due |
| Refill warning | Warns when stock is 5 or fewer. Stock drops automatically when you mark a dose as taken |
| History | Last 7, 14 or 30 days, with an adherence percentage |
| Installable | PWA manifest and service worker, so it can be added to a phone's home screen |

## Tech stack

- **Frontend:** React 18, Vite, React Router
- **Backend:** Node.js, Express 4, Mongoose
- **Database:** MongoDB (local or MongoDB Atlas)
- **Jobs and email:** node-cron, Nodemailer

## Prerequisites

- Node.js 18 or newer
- MongoDB running locally, or a free MongoDB Atlas connection string

## Project structure

```
medicine-reminder/
├── server/
│   ├── package.json
│   ├── .env
│   └── src/
│       ├── index.js
│       ├── config/db.js
│       ├── middleware/auth.js
│       ├── models/
│       │   ├── User.js
│       │   ├── Medicine.js
│       │   └── DoseLog.js
│       ├── routes/
│       │   ├── auth.js
│       │   ├── medicines.js
│       │   └── doses.js
│       ├── utils/
│       │   ├── doses.js
│       │   └── mailer.js
│       └── jobs/reminders.js
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── public/
    │   ├── manifest.json
    │   ├── sw.js
    │   └── icon.svg
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js
        ├── AuthContext.jsx
        ├── styles.css
        ├── components/Layout.jsx
        └── pages/
            ├── Auth.jsx
            ├── Today.jsx
            ├── Medicines.jsx
            └── History.jsx
```

---

# Part 1: Backend

## 1.1 `server/package.json`

```json
{
  "name": "medicine-reminder-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-async-errors": "^3.1.1",
    "jsonwebtoken": "^9.0.2",
    "mongoose": "^8.5.0",
    "node-cron": "^3.0.3",
    "nodemailer": "^6.9.14"
  }
}
```

## 1.2 `server/.env`

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/medreminder
JWT_SECRET=change-this-to-a-long-random-string
CLIENT_URL=http://localhost:5173

# Email reminders (optional). If SMTP_HOST is empty, emails are only printed in the server console.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=Medicine Reminder <no-reply@example.com>
```

> Never commit `.env` to Git. Add it to `.gitignore`.

## 1.3 `server/src/config/db.js`

```js
import mongoose from 'mongoose';

export default async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);
  console.log('MongoDB connected');
}
```

## 1.4 `server/src/models/User.js`

```js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    // Used so reminders fire at the user's local time, not the server's
    timezone: { type: String, default: 'Asia/Kolkata' },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
```

## 1.5 `server/src/models/Medicine.js`

```js
import mongoose from 'mongoose';

const medicineSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    dosage: { type: String, default: '', trim: true }, // e.g. "500 mg" or "1 tablet"
    form: {
      type: String,
      enum: ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Drops', 'Inhaler', 'Other'],
      default: 'Tablet',
    },
    times: { type: [String], default: [] },        // ["08:00", "20:00"] in 24h format
    daysOfWeek: { type: [Number], default: [] },   // 0 = Sunday ... 6 = Saturday. Empty = every day
    startDate: { type: String, required: true },   // "YYYY-MM-DD"
    endDate: { type: String, default: '' },        // "" = no end date
    stock: { type: Number, default: null },        // null = not tracked
    notes: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Medicine', medicineSchema);
```

## 1.6 `server/src/models/DoseLog.js`

```js
import mongoose from 'mongoose';

const doseLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    medicine: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
    date: { type: String, required: true },  // "YYYY-MM-DD" in the user's timezone
    time: { type: String, required: true },  // "HH:mm"
    status: { type: String, enum: ['pending', 'taken', 'skipped'], default: 'pending' },
    takenAt: { type: Date, default: null },
    reminderSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One log per medicine, per day, per time slot
doseLogSchema.index({ medicine: 1, date: 1, time: 1 }, { unique: true });
doseLogSchema.index({ user: 1, date: 1 });

export default mongoose.model('DoseLog', doseLogSchema);
```

## 1.7 `server/src/middleware/auth.js`

```js
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export default async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Please sign in.' });

  try {
    const { id } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(id).select('-password');
    if (!user) throw new Error('No user');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Your session has expired. Sign in again.' });
  }
}
```

## 1.8 `server/src/utils/doses.js`

Helpers for timezone-aware "now" and for creating the day's dose records from each medicine's schedule.

```js
import Medicine from '../models/Medicine.js';
import DoseLog from '../models/DoseLog.js';

/** Current date ("YYYY-MM-DD") and time ("HH:mm") in the given IANA timezone */
export function localNow(timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Add (or subtract) days to a "YYYY-MM-DD" string */
export function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Make sure a pending DoseLog exists for every dose scheduled on `date` */
export async function ensureDosesForDate(userId, date) {
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();

  const medicines = await Medicine.find({
    user: userId,
    active: true,
    startDate: { $lte: date },
    $or: [{ endDate: '' }, { endDate: { $gte: date } }],
  });

  const ops = [];
  for (const med of medicines) {
    if (med.daysOfWeek.length && !med.daysOfWeek.includes(dayOfWeek)) continue;
    for (const time of med.times) {
      ops.push({
        updateOne: {
          filter: { medicine: med._id, date, time },
          update: {
            $setOnInsert: {
              user: userId,
              medicine: med._id,
              date,
              time,
              status: 'pending',
              reminderSent: false,
            },
          },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) await DoseLog.bulkWrite(ops);
}
```

## 1.9 `server/src/utils/mailer.js`

```js
import nodemailer from 'nodemailer';

const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

export async function sendMail({ to, subject, text }) {
  if (!transporter) {
    console.log(`[email not configured] To: ${to} | ${subject} | ${text}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    });
  } catch (err) {
    console.error('Email failed:', err.message);
  }
}
```

## 1.10 `server/src/jobs/reminders.js`

Runs every minute. For each user, it creates today's doses and emails any that are due and still pending.

```js
import cron from 'node-cron';
import Medicine from '../models/Medicine.js';
import User from '../models/User.js';
import DoseLog from '../models/DoseLog.js';
import { ensureDosesForDate, localNow, toMinutes } from '../utils/doses.js';
import { sendMail } from '../utils/mailer.js';

async function runReminders() {
  const userIds = await Medicine.distinct('user', { active: true });
  const users = await User.find({ _id: { $in: userIds } });

  for (const user of users) {
    const { date, time } = localNow(user.timezone);
    await ensureDosesForDate(user._id, date);

    const due = await DoseLog.find({
      user: user._id,
      date,
      status: 'pending',
      reminderSent: false,
    }).populate('medicine', 'name dosage');

    const nowMin = toMinutes(time);
    for (const dose of due) {
      const diff = nowMin - toMinutes(dose.time);
      if (diff < 0) continue; // not due yet

      // Skip very old doses (for example after the server was offline)
      if (diff <= 60 && dose.medicine) {
        await sendMail({
          to: user.email,
          subject: `Time to take ${dose.medicine.name}`,
          text:
            `Hi ${user.name},\n\n` +
            `It's ${dose.time}. Please take ${dose.medicine.name}` +
            `${dose.medicine.dosage ? ` (${dose.medicine.dosage})` : ''}.\n\n` +
            `Open the app to mark it as taken.`,
        });
      }
      dose.reminderSent = true;
      await dose.save();
    }
  }
}

export default function startReminderJob() {
  cron.schedule('* * * * *', () => {
    runReminders().catch((err) => console.error('Reminder job failed:', err));
  });
  console.log('Reminder job started (runs every minute)');
}
```

## 1.11 `server/src/routes/auth.js`

```js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import auth from '../middleware/auth.js';

const router = Router();

const signToken = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, timezone: u.timezone });

router.post('/register', async (req, res) => {
  const { name, email, password, timezone } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Enter your name, email and password.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Use a password with at least 6 characters.' });
  }
  if (await User.findOne({ email: email.toLowerCase() })) {
    return res.status(409).json({ message: 'An account with this email already exists. Sign in instead.' });
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email,
    password: hash,
    timezone: timezone || 'Asia/Kolkata',
  });

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || '').toLowerCase() });

  if (!user || !(await bcrypt.compare(password || '', user.password))) {
    return res.status(401).json({ message: 'The email or password is incorrect.' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
```

## 1.12 `server/src/routes/medicines.js`

```js
import { Router } from 'express';
import Medicine from '../models/Medicine.js';
import DoseLog from '../models/DoseLog.js';
import { localNow } from '../utils/doses.js';

const router = Router();

function clean(body, today) {
  const stock = body.stock === '' || body.stock == null ? null : Number(body.stock);
  return {
    name: String(body.name || '').trim(),
    dosage: String(body.dosage || '').trim(),
    form: body.form || 'Tablet',
    times: [...new Set(body.times || [])].filter((t) => /^\d{2}:\d{2}$/.test(t)).sort(),
    daysOfWeek: [...new Set((body.daysOfWeek || []).map(Number))].filter((n) => n >= 0 && n <= 6),
    startDate: body.startDate || today,
    endDate: body.endDate || '',
    stock: Number.isFinite(stock) && stock >= 0 ? stock : null,
    notes: String(body.notes || '').trim(),
    active: body.active !== false,
  };
}

function validate(data) {
  if (!data.name) return 'Enter the medicine name.';
  if (!data.times.length) return 'Add at least one time to take it.';
  if (data.endDate && data.endDate < data.startDate) return 'The end date must be after the start date.';
  return null;
}

router.get('/', async (req, res) => {
  const medicines = await Medicine.find({ user: req.user._id }).sort({ name: 1 });
  res.json({ medicines });
});

router.post('/', async (req, res) => {
  const { date: today } = localNow(req.user.timezone);
  const data = clean(req.body, today);
  const error = validate(data);
  if (error) return res.status(400).json({ message: error });

  const medicine = await Medicine.create({ ...data, user: req.user._id });
  res.status(201).json({ medicine });
});

router.put('/:id', async (req, res) => {
  const { date: today } = localNow(req.user.timezone);
  const data = clean(req.body, today);
  const error = validate(data);
  if (error) return res.status(400).json({ message: error });

  const medicine = await Medicine.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    data,
    { new: true }
  );
  if (!medicine) return res.status(404).json({ message: 'Medicine not found.' });

  // Remove today's and future pending doses so they are rebuilt from the new schedule
  await DoseLog.deleteMany({ medicine: medicine._id, status: 'pending', date: { $gte: today } });

  res.json({ medicine });
});

router.delete('/:id', async (req, res) => {
  const medicine = await Medicine.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!medicine) return res.status(404).json({ message: 'Medicine not found.' });

  await DoseLog.deleteMany({ medicine: medicine._id });
  res.json({ ok: true });
});

export default router;
```

## 1.13 `server/src/routes/doses.js`

```js
import { Router } from 'express';
import DoseLog from '../models/DoseLog.js';
import { ensureDosesForDate, localNow, shiftDate } from '../utils/doses.js';

const router = Router();

// Today's checklist
router.get('/today', async (req, res) => {
  const { date } = localNow(req.user.timezone);
  await ensureDosesForDate(req.user._id, date);

  const doses = await DoseLog.find({ user: req.user._id, date })
    .populate('medicine', 'name dosage form notes stock')
    .sort({ time: 1 });

  res.json({ date, doses: doses.filter((d) => d.medicine) });
});

// Mark a dose as taken, skipped, or back to pending
router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'taken', 'skipped'].includes(status)) {
    return res.status(400).json({ message: 'Status must be pending, taken or skipped.' });
  }

  const dose = await DoseLog.findOne({ _id: req.params.id, user: req.user._id }).populate('medicine');
  if (!dose) return res.status(404).json({ message: 'Dose not found.' });

  const before = dose.status;
  dose.status = status;
  dose.takenAt = status === 'taken' ? new Date() : null;
  await dose.save();

  // Keep the stock count in sync
  const med = dose.medicine;
  if (med && typeof med.stock === 'number') {
    if (before !== 'taken' && status === 'taken' && med.stock > 0) med.stock -= 1;
    if (before === 'taken' && status !== 'taken') med.stock += 1;
    await med.save();
  }

  res.json({ dose });
});

// History with adherence stats
router.get('/history', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const { date: today } = localNow(req.user.timezone);
  const since = shiftDate(today, -(days - 1));

  const logs = await DoseLog.find({ user: req.user._id, date: { $gte: since, $lte: today } })
    .populate('medicine', 'name dosage')
    .sort({ date: -1, time: 1 });

  const rows = logs.map((l) => ({
    _id: l._id,
    date: l.date,
    time: l.time,
    name: l.medicine ? l.medicine.name : 'Deleted medicine',
    dosage: l.medicine ? l.medicine.dosage : '',
    // A pending dose from a previous day counts as missed
    status: l.status === 'pending' && l.date < today ? 'missed' : l.status,
  }));

  const taken = rows.filter((r) => r.status === 'taken').length;
  const missed = rows.filter((r) => r.status === 'missed').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;
  const counted = taken + missed;

  res.json({
    rows,
    stats: {
      taken,
      missed,
      skipped,
      adherence: counted ? Math.round((taken / counted) * 100) : null,
    },
  });
});

export default router;
```

## 1.14 `server/src/index.js`

```js
import 'dotenv/config';
import 'express-async-errors'; // must come before routes so async errors reach the error handler
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

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

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/medicines', auth, medicineRoutes);
app.use('/api/doses', auth, doseRoutes);

// In production, serve the built React app from the same server
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '../../client/dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server. Try again.' });
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
```

---

# Part 2: Frontend

## 2.1 `client/package.json`

```json
{
  "name": "medicine-reminder-client",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0"
  }
}
```

## 2.2 `client/vite.config.js`

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
});
```

## 2.3 `client/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#146c72" />
    <link rel="manifest" href="/manifest.json" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <title>Medicine Reminder</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

## 2.4 `client/public/manifest.json`

```json
{
  "name": "Medicine Reminder",
  "short_name": "Medicines",
  "description": "Never miss a dose.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f4f8f9",
  "theme_color": "#146c72",
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }
  ]
}
```

## 2.5 `client/public/icon.svg`

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#146c72"/>
  <g transform="rotate(-40 256 256)">
    <rect x="96" y="176" width="320" height="160" rx="80" fill="#f4f8f9"/>
    <path d="M256 176h84a80 80 0 0 1 0 160h-84z" fill="#e0a43a"/>
  </g>
</svg>
```

## 2.6 `client/public/sw.js`

A minimal service worker. It makes the app installable and lets notifications work on phones.

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      if (list.length) return list[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
```

## 2.7 `client/src/main.jsx`

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './AuthContext.jsx';
import './styles.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
```

## 2.8 `client/src/api.js`

```js
const BASE = import.meta.env.VITE_API_URL || '/api';

export async function api(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('token');

  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Something went wrong. Try again.');
  return data;
}
```

## 2.9 `client/src/AuthContext.jsx`

```jsx
import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      setLoading(false);
      return;
    }
    api('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem('token', data.token);
    setUser(data.user);
  }

  async function register(name, email, password) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const data = await api('/auth/register', {
      method: 'POST',
      body: { name, email, password, timezone },
    });
    localStorage.setItem('token', data.token);
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem('token');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
```

## 2.10 `client/src/App.jsx`

```jsx
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Auth from './pages/Auth.jsx';
import Today from './pages/Today.jsx';
import Medicines from './pages/Medicines.jsx';
import History from './pages/History.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="center-note">Loading...</p>;
  return user ? children : <Navigate to="/login" replace />;
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="center-note">Loading...</p>;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><Auth mode="login" /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Auth mode="register" /></GuestOnly>} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<Today />} />
        <Route path="/medicines" element={<Medicines />} />
        <Route path="/history" element={<History />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

## 2.11 `client/src/components/Layout.jsx`

```jsx
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Medicine Reminder</div>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>Today</NavLink>
          <NavLink to="/medicines">Medicines</NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
        <div className="who">
          <span>{user.name}</span>
          <button className="btn btn-quiet" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
```

## 2.12 `client/src/pages/Auth.jsx`

One component for both sign in and create account.

```jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Auth({ mode }) {
  const isLogin = mode === 'login';
  const { login, register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isLogin) await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>{isLogin ? 'Sign in' : 'Create your account'}</h1>
        <p className="muted">
          {isLogin
            ? 'See today\'s medicines and mark them as taken.'
            : 'Add your medicines once. We remind you every day.'}
        </p>

        {!isLogin && (
          <label>
            Your name
            <input value={form.name} onChange={set('name')} autoComplete="name" required />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </label>

        {error && <p className="error" role="alert">{error}</p>}

        <button className="btn btn-primary btn-wide" disabled={busy}>
          {busy ? 'Please wait...' : isLogin ? 'Sign in' : 'Create account'}
        </button>

        <p className="muted switch">
          {isLogin ? (
            <>New here? <Link to="/register">Create an account</Link></>
          ) : (
            <>Already have an account? <Link to="/login">Sign in</Link></>
          )}
        </p>
      </form>
    </div>
  );
}
```

## 2.13 `client/src/pages/Today.jsx`

The daily checklist, with browser notifications and snooze.

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const SNOOZE_MINUTES = 10;

const hhmm = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const minutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const label12 = (t) => {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
};

async function showNotification(title, body) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) return reg.showNotification(title, { body, icon: '/icon.svg', tag: title + body });
  } catch { /* fall through */ }
  new Notification(title, { body, icon: '/icon.svg' });
}

export default function Today() {
  const [doses, setDoses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(hhmm());
  const [snoozed, setSnoozed] = useState({});               // id -> timestamp (ms)
  const [permission, setPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const alerts = useRef({});                                // id -> next alert time (ms) or Infinity

  const load = useCallback(async () => {
    try {
      const data = await api('/doses/today');
      setDoses(data.doses);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Tick every 30 seconds to update statuses and refresh the list
  useEffect(() => {
    const id = setInterval(() => {
      setNow(hhmm());
      load();
    }, 30000);
    return () => clearInterval(id);
  }, [load]);

  // Fire a notification once when a pending dose becomes due (or when a snooze ends)
  useEffect(() => {
    if (permission !== 'granted') return;
    doses.forEach((d) => {
      if (d.status !== 'pending' || d.time > now) return;
      const next = alerts.current[d._id];
      const shouldAlert = next === undefined || (next !== Infinity && Date.now() >= next);
      if (shouldAlert) {
        alerts.current[d._id] = Infinity;
        showNotification(
          `Time to take ${d.medicine.name}`,
          `${d.medicine.dosage || ''} at ${label12(d.time)}`.trim()
        );
      }
    });
  }, [doses, now, permission]);

  async function enableNotifications() {
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  async function setStatus(dose, status) {
    // Update the screen immediately, then save
    setDoses((list) => list.map((d) => (d._id === dose._id ? { ...d, status } : d)));
    try {
      await api(`/doses/${dose._id}`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  function snooze(dose) {
    const until = Date.now() + SNOOZE_MINUTES * 60 * 1000;
    alerts.current[dose._id] = until;
    setSnoozed((s) => ({ ...s, [dose._id]: until }));
  }

  function stateOf(d) {
    if (d.status === 'taken') return 'taken';
    if (d.status === 'skipped') return 'skipped';
    const late = minutes(now) - minutes(d.time);
    if (late > 60) return 'late';
    if (late >= 0) return 'due';
    return 'upcoming';
  }

  const taken = doses.filter((d) => d.status === 'taken').length;
  const remaining = doses.filter((d) => d.status === 'pending').length;

  if (loading) return <p className="center-note">Loading today's medicines...</p>;

  return (
    <section>
      <h1>Today</h1>
      <p className="muted">
        {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        {doses.length > 0 && ` · ${taken} of ${doses.length} taken`}
      </p>

      {permission === 'default' && (
        <div className="banner">
          <span>Turn on notifications to get a pop-up when a dose is due.</span>
          <button className="btn btn-primary" onClick={enableNotifications}>Turn on notifications</button>
        </div>
      )}
      {permission === 'denied' && (
        <div className="banner banner-warn">
          Notifications are blocked. Allow them in your browser's site settings to get pop-up reminders.
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      {doses.length === 0 ? (
        <div className="empty">
          <h2>Nothing scheduled today</h2>
          <p>Add a medicine and set when to take it.</p>
          <Link className="btn btn-primary" to="/medicines">Add a medicine</Link>
        </div>
      ) : (
        <>
          {remaining === 0 && <p className="done">All done for today. Well done.</p>}
          <ul className="dose-list">
            {doses.map((d) => {
              const state = stateOf(d);
              const snoozeUntil = snoozed[d._id];
              const isSnoozed = snoozeUntil && snoozeUntil > Date.now() && d.status === 'pending';
              return (
                <li key={d._id} className={`dose dose-${state}`}>
                  <div className="dose-time">{label12(d.time)}</div>
                  <div className="dose-body">
                    <div className="dose-name">{d.medicine.name}</div>
                    <div className="muted">
                      {[d.medicine.dosage, d.medicine.form].filter(Boolean).join(' · ')}
                    </div>
                    {d.medicine.notes && <div className="muted small">{d.medicine.notes}</div>}
                    {typeof d.medicine.stock === 'number' && d.medicine.stock <= 5 && (
                      <div className="refill">
                        {d.medicine.stock === 0 ? 'None left. Refill now.' : `Only ${d.medicine.stock} left. Refill soon.`}
                      </div>
                    )}
                    {isSnoozed && (
                      <div className="muted small">
                        Snoozed until {hhmm(new Date(snoozeUntil))}
                      </div>
                    )}
                  </div>

                  <div className="dose-actions">
                    {d.status === 'pending' ? (
                      <>
                        <button className="btn btn-primary" onClick={() => setStatus(d, 'taken')}>Taken</button>
                        <button className="btn" onClick={() => setStatus(d, 'skipped')}>Skip</button>
                        {state !== 'upcoming' && (
                          <button className="btn btn-quiet" onClick={() => snooze(d)}>
                            Snooze {SNOOZE_MINUTES} min
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="badge">{d.status === 'taken' ? 'Taken' : 'Skipped'}</span>
                        <button className="btn btn-quiet" onClick={() => setStatus(d, 'pending')}>Undo</button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
```

## 2.14 `client/src/pages/Medicines.jsx`

List, add, edit, and delete medicines.

```jsx
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Drops', 'Inhaler', 'Other'];

const PRESETS = [
  { label: 'Once a day', times: ['08:00'] },
  { label: 'Twice a day', times: ['08:00', '20:00'] },
  { label: 'Three times a day', times: ['08:00', '14:00', '20:00'] },
];

function todayStr() {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const emptyForm = () => ({
  name: '',
  dosage: '',
  form: 'Tablet',
  times: ['08:00'],
  daysOfWeek: [],
  startDate: todayStr(),
  endDate: '',
  stock: '',
  notes: '',
});

const label12 = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

function MedicineForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const editing = Boolean(initial._id);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const setTime = (i, value) =>
    setForm({ ...form, times: form.times.map((t, idx) => (idx === i ? value : t)) });
  const addTime = () => setForm({ ...form, times: [...form.times, '12:00'] });
  const removeTime = (i) => setForm({ ...form, times: form.times.filter((_, idx) => idx !== i) });

  const toggleDay = (n) =>
    setForm({
      ...form,
      daysOfWeek: form.daysOfWeek.includes(n)
        ? form.daysOfWeek.filter((d) => d !== n)
        : [...form.daysOfWeek, n],
    });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (editing) await api(`/medicines/${initial._id}`, { method: 'PUT', body: form });
      else await api('/medicines', { method: 'POST', body: form });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{editing ? 'Edit medicine' : 'Add a medicine'}</h2>

      <div className="grid-2">
        <label>
          Medicine name
          <input value={form.name} onChange={set('name')} placeholder="Metformin" required />
        </label>
        <label>
          Dosage
          <input value={form.dosage} onChange={set('dosage')} placeholder="500 mg or 1 tablet" />
        </label>
      </div>

      <label>
        Type
        <select value={form.form} onChange={set('form')}>
          {FORMS.map((f) => <option key={f}>{f}</option>)}
        </select>
      </label>

      <fieldset>
        <legend>When do you take it?</legend>
        <div className="chips">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.label}
              className="btn btn-quiet"
              onClick={() => setForm({ ...form, times: p.times })}
            >
              {p.label}
            </button>
          ))}
        </div>
        {form.times.map((t, i) => (
          <div className="time-row" key={i}>
            <input
              type="time"
              value={t}
              onChange={(e) => setTime(i, e.target.value)}
              aria-label={`Time ${i + 1}`}
              required
            />
            {form.times.length > 1 && (
              <button type="button" className="btn btn-quiet" onClick={() => removeTime(i)}>Remove</button>
            )}
          </div>
        ))}
        <button type="button" className="btn" onClick={addTime}>Add another time</button>
      </fieldset>

      <fieldset>
        <legend>Which days?</legend>
        <p className="muted small">Leave all unselected to take it every day.</p>
        <div className="chips">
          {DAYS.map((d, i) => (
            <button
              type="button"
              key={d}
              className={`chip ${form.daysOfWeek.includes(i) ? 'chip-on' : ''}`}
              aria-pressed={form.daysOfWeek.includes(i)}
              onClick={() => toggleDay(i)}
            >
              {d}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid-2">
        <label>
          Start date
          <input type="date" value={form.startDate} onChange={set('startDate')} required />
        </label>
        <label>
          End date (optional)
          <input type="date" value={form.endDate} onChange={set('endDate')} min={form.startDate} />
        </label>
      </div>

      <div className="grid-2">
        <label>
          Tablets or doses left (optional)
          <input type="number" min="0" value={form.stock} onChange={set('stock')} />
        </label>
        <label>
          Notes (optional)
          <input value={form.notes} onChange={set('notes')} placeholder="Take after food" />
        </label>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving...' : editing ? 'Save changes' : 'Save medicine'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function Medicines() {
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = hidden, object = form data
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await api('/medicines');
      setMedicines(data.medicines);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function remove(m) {
    if (!window.confirm(`Delete ${m.name}? Its history will be removed too.`)) return;
    try {
      await api(`/medicines/${m._id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function describeDays(days) {
    if (!days.length || days.length === 7) return 'Every day';
    return [...days].sort().map((d) => DAYS[d]).join(', ');
  }

  if (loading) return <p className="center-note">Loading medicines...</p>;

  return (
    <section>
      <div className="row between">
        <h1>Medicines</h1>
        {!editing && (
          <button className="btn btn-primary" onClick={() => setEditing(emptyForm())}>Add a medicine</button>
        )}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {editing && (
        <MedicineForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {!editing && medicines.length === 0 && (
        <div className="empty">
          <h2>No medicines yet</h2>
          <p>Add your first medicine to start getting reminders.</p>
        </div>
      )}

      <ul className="med-list">
        {medicines.map((m) => (
          <li key={m._id} className="card med">
            <div>
              <div className="dose-name">{m.name}</div>
              <div className="muted">{[m.dosage, m.form].filter(Boolean).join(' · ')}</div>
              <div className="small">{m.times.map(label12).join(', ')} · {describeDays(m.daysOfWeek)}</div>
              <div className="muted small">
                From {m.startDate}{m.endDate ? ` to ${m.endDate}` : ''}
              </div>
              {typeof m.stock === 'number' && (
                <div className={m.stock <= 5 ? 'refill' : 'muted small'}>
                  {m.stock} left{m.stock <= 5 ? '. Refill soon.' : ''}
                </div>
              )}
            </div>
            <div className="row">
              <button className="btn" onClick={() => setEditing({ ...m })}>Edit</button>
              <button className="btn btn-danger" onClick={() => remove(m)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

## 2.15 `client/src/pages/History.jsx`

```jsx
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const label12 = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const STATUS_TEXT = { taken: 'Taken', missed: 'Missed', skipped: 'Skipped', pending: 'Not yet' };

export default function History() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    api(`/doses/history?days=${days}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [days]);

  const grouped = {};
  (data?.rows || []).forEach((r) => {
    (grouped[r.date] ||= []).push(r);
  });

  return (
    <section>
      <div className="row between">
        <h1>History</h1>
        <label className="inline">
          Show
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </label>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <p className="center-note">Loading history...</p>}

      {data && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-num">{data.stats.adherence === null ? '-' : `${data.stats.adherence}%`}</div>
              <div className="muted">Doses taken on time or later</div>
            </div>
            <div className="stat"><div className="stat-num ok">{data.stats.taken}</div><div className="muted">Taken</div></div>
            <div className="stat"><div className="stat-num bad">{data.stats.missed}</div><div className="muted">Missed</div></div>
            <div className="stat"><div className="stat-num">{data.stats.skipped}</div><div className="muted">Skipped</div></div>
          </div>

          {data.rows.length === 0 && (
            <div className="empty">
              <h2>No history yet</h2>
              <p>Doses you take, skip or miss will show up here.</p>
            </div>
          )}

          {Object.entries(grouped).map(([date, rows]) => (
            <div key={date} className="day">
              <h2>
                {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}
              </h2>
              <ul className="log-list">
                {rows.map((r) => (
                  <li key={r._id} className={`log log-${r.status}`}>
                    <span className="log-time">{label12(r.time)}</span>
                    <span className="log-name">
                      {r.name}{r.dosage ? ` (${r.dosage})` : ''}
                    </span>
                    <span className="badge">{STATUS_TEXT[r.status]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
```

## 2.16 `client/src/styles.css`

Large type, high contrast, big tap targets, and colour paired with a text label so status never depends on colour alone.

```css
@import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap');

:root {
  --bg: #f4f8f9;
  --surface: #ffffff;
  --ink: #14262b;
  --muted: #4d6469;
  --line: #d3e0e3;
  --primary: #146c72;
  --primary-dark: #0e5358;
  --ok: #2b7a4b;
  --ok-bg: #e5f3ea;
  --due: #9a5b00;
  --due-bg: #fff2d9;
  --bad: #b3261e;
  --bad-bg: #fde8e6;
  --radius: 12px;
}

* { box-sizing: border-box; }

html { font-size: 18px; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: 'Atkinson Hyperlegible', system-ui, -apple-system, 'Segoe UI', sans-serif;
  line-height: 1.5;
}

h1 { font-size: 1.9rem; margin: 0 0 0.25rem; }
h2 { font-size: 1.25rem; margin: 0 0 0.5rem; }

a { color: var(--primary-dark); }

.muted { color: var(--muted); }
.small { font-size: 0.9rem; }
.center-note { text-align: center; padding: 3rem 1rem; color: var(--muted); }
.error { color: var(--bad); background: var(--bad-bg); padding: 0.6rem 0.8rem; border-radius: 8px; }

/* Layout */
.topbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1.5rem;
  padding: 0.75rem 1.25rem; background: var(--surface); border-bottom: 1px solid var(--line);
}
.brand { font-weight: 700; color: var(--primary); font-size: 1.15rem; }
.nav { display: flex; gap: 0.25rem; flex: 1; }
.nav a {
  padding: 0.5rem 0.9rem; border-radius: 8px; text-decoration: none; color: var(--ink); font-weight: 700;
}
.nav a.active { background: var(--primary); color: #fff; }
.who { display: flex; align-items: center; gap: 0.5rem; }
.page { max-width: 820px; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
.row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.between { justify-content: space-between; }

/* Buttons and inputs */
.btn {
  font: inherit; font-weight: 700; cursor: pointer;
  min-height: 44px; padding: 0.5rem 1.1rem; border-radius: 10px;
  border: 2px solid var(--primary); background: var(--surface); color: var(--primary-dark);
}
.btn:hover { background: #e6f1f2; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-dark); }
.btn-quiet { border-color: transparent; background: transparent; }
.btn-danger { border-color: var(--bad); color: var(--bad); }
.btn-danger:hover { background: var(--bad-bg); }
.btn-wide { width: 100%; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

:focus-visible { outline: 3px solid #e0a43a; outline-offset: 2px; }

label { display: flex; flex-direction: column; gap: 0.3rem; font-weight: 700; margin-bottom: 0.9rem; }
label.inline { flex-direction: row; align-items: center; margin: 0; }
input, select {
  font: inherit; font-weight: 400; min-height: 44px; padding: 0.45rem 0.7rem;
  border: 2px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink);
}
input:focus, select:focus { border-color: var(--primary); }
fieldset { border: 1px solid var(--line); border-radius: var(--radius); margin: 0 0 1rem; padding: 0.75rem 1rem 1rem; }
legend { font-weight: 700; padding: 0 0.4rem; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1rem; }
.time-row { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.5rem; }
.chip {
  font: inherit; font-weight: 700; min-height: 44px; min-width: 56px; padding: 0 0.8rem;
  border: 2px solid var(--line); border-radius: 999px; background: #fff; cursor: pointer;
}
.chip-on { background: var(--primary); border-color: var(--primary); color: #fff; }

/* Cards */
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 1rem 1.25rem; }
.form { margin: 1rem 0; }
.empty { text-align: center; padding: 2.5rem 1rem; background: var(--surface); border: 1px dashed var(--line); border-radius: var(--radius); margin-top: 1rem; }

.banner {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem;
  background: #e6f1f2; border-radius: var(--radius); padding: 0.75rem 1rem; margin: 1rem 0;
}
.banner-warn { background: var(--due-bg); color: var(--due); }
.done { background: var(--ok-bg); color: var(--ok); padding: 0.7rem 1rem; border-radius: var(--radius); font-weight: 700; }

/* Today */
.dose-list, .med-list, .log-list { list-style: none; padding: 0; margin: 1rem 0 0; display: grid; gap: 0.75rem; }
.dose {
  display: grid; grid-template-columns: 6.5rem 1fr auto; gap: 1rem; align-items: center;
  background: var(--surface); border: 1px solid var(--line); border-left: 8px solid var(--line);
  border-radius: var(--radius); padding: 1rem;
}
.dose-time { font-weight: 700; font-size: 1.1rem; }
.dose-name { font-weight: 700; font-size: 1.2rem; }
.dose-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: flex-end; align-items: center; }
.dose-upcoming { border-left-color: var(--line); }
.dose-due { border-left-color: var(--due); background: var(--due-bg); }
.dose-late { border-left-color: var(--bad); background: var(--bad-bg); }
.dose-taken { border-left-color: var(--ok); background: var(--ok-bg); }
.dose-skipped { border-left-color: var(--muted); opacity: 0.8; }
.refill { color: var(--bad); font-weight: 700; font-size: 0.95rem; }
.badge { font-weight: 700; padding: 0.2rem 0.7rem; border-radius: 999px; background: #fff; border: 1px solid var(--line); }

/* Medicines */
.med { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: center; }

/* History */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin: 1rem 0 1.5rem; }
.stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 0.8rem 1rem; }
.stat-num { font-size: 1.8rem; font-weight: 700; }
.stat-num.ok { color: var(--ok); }
.stat-num.bad { color: var(--bad); }
.day { margin-top: 1.5rem; }
.log {
  display: grid; grid-template-columns: 6rem 1fr auto; gap: 0.75rem; align-items: center;
  background: var(--surface); border: 1px solid var(--line); border-left: 6px solid var(--line);
  border-radius: 10px; padding: 0.6rem 0.9rem;
}
.log-taken { border-left-color: var(--ok); }
.log-missed { border-left-color: var(--bad); }
.log-skipped { border-left-color: var(--muted); }
.log-time { font-weight: 700; }

/* Auth */
.auth-wrap { min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; }
.auth-card {
  width: 100%; max-width: 420px; background: var(--surface); border: 1px solid var(--line);
  border-radius: 16px; padding: 2rem;
}
.auth-card .muted { margin-top: 0; margin-bottom: 1.25rem; }
.switch { text-align: center; margin-bottom: 0; }

/* Small screens */
@media (max-width: 640px) {
  .grid-2 { grid-template-columns: 1fr; }
  .stats { grid-template-columns: 1fr 1fr; }
  .dose { grid-template-columns: 1fr; gap: 0.5rem; }
  .dose-actions { justify-content: flex-start; }
  .log { grid-template-columns: 1fr auto; }
  .log-time { grid-column: 1 / -1; }
  .nav { order: 3; width: 100%; }
  .who { margin-left: auto; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
```

---

# Part 3: Run it

## 3.1 Start MongoDB

Local install: make sure `mongod` is running. Or use MongoDB Atlas (free tier) and paste its connection string into `MONGODB_URI`.

## 3.2 Start the backend

```bash
cd server
npm install
npm run dev
```

You should see `MongoDB connected`, `Server running on http://localhost:5000` and `Reminder job started`.

## 3.3 Start the frontend

```bash
cd client
npm install
npm run dev
```

Open **http://localhost:5173**, create an account, add a medicine with a time a couple of minutes from now, and open the **Today** tab. Allow notifications when asked.

## 3.4 Test the reminder email

Leave `SMTP_*` empty at first. When a dose becomes due, the server console prints `[email not configured] ...`. To send real emails, fill in SMTP details. Gmail (with an app password), Brevo, or Resend's SMTP all work.

---

# Part 4: API reference

All routes except `/api/auth/register` and `/api/auth/login` need the header `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create an account. Body: `name, email, password, timezone` |
| POST | `/api/auth/login` | Sign in. Body: `email, password` |
| GET | `/api/auth/me` | Current user |
| GET | `/api/medicines` | List medicines |
| POST | `/api/medicines` | Add a medicine |
| PUT | `/api/medicines/:id` | Update a medicine |
| DELETE | `/api/medicines/:id` | Delete a medicine and its logs |
| GET | `/api/doses/today` | Today's checklist (created from schedules) |
| PATCH | `/api/doses/:id` | Set `status` to `taken`, `skipped` or `pending` |
| GET | `/api/doses/history?days=14` | Past doses and adherence stats |

---

# Part 5: Deploying

**Option A: one server (simplest)**

1. Build the client: `cd client && npm run build`
2. Set `NODE_ENV=production` on the server. Express then serves `client/dist` itself.
3. Host the `server` folder (with `client/dist` next to it) on Render, Railway or a VPS.
4. Use MongoDB Atlas for the database. Set `MONGODB_URI`, `JWT_SECRET`, `CLIENT_URL` and the SMTP variables as environment variables on the host.

**Option B: split hosting**

- Frontend on Vercel or Netlify. Set `VITE_API_URL=https://your-api.example.com/api` at build time.
- Backend on Render or Railway. Set `CLIENT_URL` to your frontend's URL so CORS allows it.

> The reminder job runs inside the server process. Free hosting tiers that put the server to sleep will pause reminders. Use an always-on plan for real use.

---

# Part 6: Known limits and next steps

- **Browser notifications only fire while the app is open** (in a tab or as an installed PWA). Email reminders work even when it is closed. For true background pop-ups, add Web Push: generate VAPID keys, store each user's `PushSubscription` in MongoDB, and send from the cron job with the `web-push` package.
- **SMS or WhatsApp reminders:** call the Twilio API from `reminders.js` next to `sendMail`.
- **Caregiver alerts:** add a `caregiverEmail` field to `User`, and email them when a dose stays pending for more than an hour.
- **Multiple profiles (parents, kids):** add a `Profile` model and a `profile` field on `Medicine` and `DoseLog`.
- **Malayalam / multi-language:** move UI text into a translations file and use `react-i18next`.
- **Security hardening for production:** add `helmet`, rate limiting on `/api/auth` (`express-rate-limit`), and move the token into an httpOnly cookie.
- **Medical disclaimer:** this app is a reminder tool, not medical advice. Users should follow their doctor's instructions for dosing.
