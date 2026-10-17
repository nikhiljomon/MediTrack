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
