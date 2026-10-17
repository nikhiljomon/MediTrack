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
