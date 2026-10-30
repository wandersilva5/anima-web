import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Icon } from './Icon';

const tabs = [
  { to: '/', label: 'Galeria', icon: 'image' as const, end: true },
  { to: '/favoritos', label: 'Favoritas', icon: 'heart' as const, end: false },
  { to: '/admin', label: 'Admin', icon: 'settings' as const, end: false },
];

export default function AppShell() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-col bg-ink-900">
      <header className="safe-top sticky top-0 z-20 border-b border-ink-800 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/20 text-accent-soft">
              <Icon name="image" className="h-4.5 w-4.5" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">
              {me?.settings.site_name ?? 'Galeria Anima'}
            </span>
          </Link>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-full bg-ink-800 text-xs font-semibold uppercase text-zinc-300"
              aria-label="Menu da conta"
            >
              {me?.user.username.slice(0, 2)}
            </button>

            {menuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-30 cursor-default"
                  aria-label="Fechar menu"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-40 mt-2 w-48 overflow-hidden rounded-xl border border-ink-700 bg-ink-800 shadow-xl">
                  <div className="border-b border-ink-700 px-3 py-2 text-xs text-zinc-400">
                    Conectado como
                    <div className="text-sm font-medium text-zinc-100">{me?.user.username}</div>
                  </div>
                  <Link
                    to="/admin"
                    className="flex items-center gap-2 px-3 py-2.5 text-sm text-zinc-200 active:bg-ink-700"
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon name="settings" className="h-4 w-4" />
                    Painel
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-300 active:bg-ink-700"
                  >
                    <Icon name="logout" className="h-4 w-4" />
                    Sair
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-3 pb-28 pt-3">
        <Outlet />
      </main>

      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-20 border-t border-ink-800 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-stretch">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ${
                  isActive ? 'text-accent-soft' : 'text-zinc-500'
                }`
              }
            >
              <Icon name={tab.icon} className="h-5 w-5" filled={false} />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
