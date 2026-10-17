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
