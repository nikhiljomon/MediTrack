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
