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
