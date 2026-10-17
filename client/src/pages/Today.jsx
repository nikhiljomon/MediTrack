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
