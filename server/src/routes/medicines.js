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
