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
