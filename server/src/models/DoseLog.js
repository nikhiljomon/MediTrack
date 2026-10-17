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
