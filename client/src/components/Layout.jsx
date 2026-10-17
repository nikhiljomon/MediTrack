import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">MediTrack</div>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>Today</NavLink>
          <NavLink to="/medicines">Medicines</NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
        <div className="who">
          <span>{user.name}</span>
          <button className="btn btn-quiet" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
