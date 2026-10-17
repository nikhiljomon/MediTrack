# MediTrack - Medicine Reminder

A full-stack medicine reminder and adherence tracking application (React + Node.js/Express + MongoDB).

## Features

- **Daily Checklist:** View scheduled doses for today, mark as taken, skipped, snooze, or undo.
- **Medicine Management:** Add, edit, and delete medications with schedule (times, days of week, start/end dates) and stock count.
- **Stock Tracking & Refill Alerts:** Automatic decrement on dose intake and refill warning when 5 or fewer doses remain.
- **Adherence & History:** 7, 14, or 30-day view with percentage adherence calculation.
- **Reminders:** In-browser pop-ups and scheduled background email reminders (`node-cron` + `nodemailer`).
- **PWA Ready:** Installable with service worker and manifest.

## Getting Started

### 1. Backend (`/server`)

Ensure MongoDB is running locally (default: `mongodb://127.0.0.1:27017/medreminder`) or provide your MongoDB Atlas connection string in `server/.env`.

```bash
cd server
npm install
npm run dev
```

The server will run on `http://localhost:5000`.

### 2. Frontend (`/client`)

In a new terminal:

```bash
cd client
npm install
npm run dev
```

The app will run on `http://localhost:5173`.
