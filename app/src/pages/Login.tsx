import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { Icon } from '../components/Icon';

export default function Login() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  useEffect(() => {
    if (me) navigate(from, { replace: true });
  }, [me, from, navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.login(username.trim(), password);
      await refresh();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel entrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="safe-top flex min-h-full flex-col justify-center bg-ink-900 px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent-soft">
            <Icon name="lock" className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Galeria Anima</h1>
          <p className="text-[13px] text-zinc-500">Acesso privado. Entre com sua conta de administrador.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">Usuario</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full py-3"
              required
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">Senha</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="w-full py-3"
              required
            />
          </label>

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-60">
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-600">
          Sessao de 30 dias neste dispositivo.
          <br />
          Para trocar a senha use o painel Admin &rsaquo; Acesso.
        </p>
      </div>
    </div>
  );
}
