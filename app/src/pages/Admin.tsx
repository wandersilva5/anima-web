import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { copyText, formatBytes, formatDateTime, formatNumber } from '../lib/format';
import type { AdminTag, Stats, TrashItem, UploadRow } from '../lib/types';

type Tab = 'painel' | 'lixeira' | 'tags' | 'uploads' | 'acesso';

const TABS: { key: Tab; label: string; icon: 'settings' | 'trash' | 'tag' | 'upload' | 'lock' }[] = [
  { key: 'painel', label: 'Painel', icon: 'settings' },
  { key: 'lixeira', label: 'Lixeira', icon: 'trash' },
  { key: 'tags', label: 'Tags', icon: 'tag' },
  { key: 'uploads', label: 'Envios', icon: 'upload' },
  { key: 'acesso', label: 'Acesso', icon: 'lock' },
];

export const CATEGORIES: { key: string; label: string }[] = [
  { key: 'cabelo', label: 'Cabelo' },
  { key: 'olhos', label: 'Olhos' },
  { key: 'rosto', label: 'Rosto' },
  { key: 'expressao', label: 'Expressão' },
  { key: 'pose', label: 'Pose' },
  { key: 'corpo', label: 'Corpo' },
  { key: 'roupa', label: 'Roupa' },
  { key: 'acessorios', label: 'Acessórios' },
  { key: 'cenario', label: 'Cenário' },
  { key: 'iluminacao', label: 'Iluminação' },
  { key: 'estilo', label: 'Estilo' },
  { key: 'hora', label: 'Hora do dia' },
  { key: 'outros', label: 'Outros' },
];

const sqlDate = (value: string | null) => (value ? value.slice(0, 16).replace('T', ' ') : '—');

export default function Admin() {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = (searchParams.get('aba') as Tab | null) ?? 'painel';
  const tab: Tab = TABS.some((item) => item.key === current) ? current : 'painel';

  return (
    <div className="space-y-4">
      <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSearchParams(item.key === 'painel' ? {} : { aba: item.key }, { replace: true })}
            className={`chip shrink-0 ${tab === item.key ? 'chip-on' : ''}`}
          >
            <Icon name={item.icon} className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'painel' && <PanelTab />}
      {tab === 'lixeira' && <TrashTab />}
      {tab === 'tags' && <TagsTab />}
      {tab === 'uploads' && <UploadsTab />}
      {tab === 'acesso' && <AccessTab />}
    </div>
  );
}

// ------------------------------------------------------------------- painel

function PanelTab() {
  const { refresh } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [siteName, setSiteName] = useState('');
  const [pageLimit, setPageLimit] = useState(48);
  const [privacyBlur, setPrivacyBlur] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch(() => undefined);
    api
      .settings()
      .then((data) => {
        setSiteName(data.settings.site_name ?? 'Galeria Anima');
        setPageLimit(Number.parseInt(data.settings.page_limit ?? '48', 10) || 48);
        setPrivacyBlur(data.settings.privacy_blur === '1');
      })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.saveSettings({ site_name: siteName, page_limit: pageLimit, privacy_blur: privacyBlur });
      await refresh();
      setMessage('Configurações salvas.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    setError(null);
    setMessage(null);
    try {
      const data = await api.rotateSyncToken();
      setToken(data.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o token.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Imagens" value={formatNumber(stats?.images)} icon="image" />
        <StatCard label="Favoritas" value={formatNumber(stats?.favorites)} icon="heart" />
        <StatCard label="Na lixeira" value={formatNumber(stats?.trash)} icon="trash" />
        <StatCard label="Exclusões pendentes" value={formatNumber(stats?.pending_local_deletions)} icon="sync" />
        <StatCard label="Modelos" value={formatNumber(stats?.models)} icon="tag" />
        <StatCard label="LoRAs" value={formatNumber(stats?.loras)} icon="tag" />
        <StatCard label="Tags" value={formatNumber(stats?.tags)} icon="tag" />
        <StatCard label="Uso em disco" value={formatBytes(stats?.bytes_total)} icon="upload" />
      </div>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Galeria</h2>

        <label className="block space-y-1.5">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Nome do site</span>
          <input value={siteName} onChange={(event) => setSiteName(event.target.value)} className="w-full" />
        </label>

        <label className="block space-y-1.5">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Imagens por página</span>
          <input
            type="number"
            min={12}
            max={96}
            value={pageLimit}
            onChange={(event) => setPageLimit(Number.parseInt(event.target.value, 10) || 48)}
            className="w-full"
          />
        </label>

        <label className="flex items-start gap-3 rounded-xl bg-ink-900 p-3">
          <input
            type="checkbox"
            checked={privacyBlur}
            onChange={(event) => setPrivacyBlur(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#7c5cff]"
          />
          <span className="text-[12px] leading-relaxed text-zinc-300">
            Modo privacidade
            <span className="block text-zinc-500">Borrar as miniaturas até o toque no celular.</span>
          </span>
        </label>

        {message && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-200">{message}</p>}
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}

        <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary w-full">
          {saving ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Sincronização</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
            Use este token no app <span className="text-zinc-300">Anima Gallery Sync</span>. Ele não dá acesso ao painel.
          </p>
        </div>

        {token && (
          <div className="space-y-1.5 rounded-xl border border-accent/40 bg-accent/10 p-3">
            <p className="text-[11px] uppercase tracking-wide text-accent-soft">Copie agora — não será exibido de novo</p>
            <p className="break-all font-mono text-[11px] leading-relaxed text-zinc-100">{token}</p>
            <button
              type="button"
              onClick={() => void copyText(token)}
              className="flex items-center gap-1 text-[11px] text-accent-soft"
            >
              <Icon name="copy" className="h-3.5 w-3.5" />
              copiar token
            </button>
          </div>
        )}

        <button type="button" onClick={() => void rotate()} className="btn-ghost w-full">
          <Icon name="sync" className="h-4 w-4" />
          {token ? 'Gerar outro token' : 'Gerar novo token de sincronização'}
        </button>

        <ol className="space-y-1 text-[11px] leading-relaxed text-zinc-500">
          <li>1. Abra o app no PC e cole a URL do site e o token.</li>
          <li>2. Toque em Sincronizar — só as imagens novas sobem.</li>
          <li>3. As exclusões da lixeira aparecem no app para confirmar.</li>
        </ol>

        {stats?.last_upload && (
          <p className="text-[11px] text-zinc-500">
            Último envio: <span className="text-zinc-300">{sqlDate(stats.last_upload)}</span>
          </p>
        )}
        {stats?.newest && (
          <p className="text-[11px] text-zinc-500">
            Geração mais recente: <span className="text-zinc-300">{formatDateTime(stats.newest)}</span>
          </p>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: 'image' | 'heart' | 'trash' | 'sync' | 'tag' | 'upload' }) {
  return (
    <div className="card flex items-center gap-2.5 px-3 py-2.5">
      <Icon name={icon} className="h-4 w-4 shrink-0 text-zinc-500" />
      <div className="min-w-0">
        <div className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
        <div className="text-sm font-semibold text-zinc-100">{value}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ lixeira

function TrashTab() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<'queue' | 'purge' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.trash();
      setItems(data.items);
      setPending(data.pending_local);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao carregar a lixeira.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<{ queued?: number; purged?: number; uuid?: string }>, successText: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(successText);
      setConfirming(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Lixeira</h2>
        <p className="text-[12px] leading-relaxed text-zinc-500">
          Esvaziar a lixeira cria uma fila de exclusão para o PC. Nada é apagado do computador sem você confirmar no app.
        </p>

        <div className="flex items-center justify-between rounded-xl bg-ink-900 px-3 py-2 text-[12px]">
          <span className="text-zinc-400">Na lixeira</span>
          <span className="font-semibold text-zinc-100">{formatNumber(items.length)}</span>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-ink-900 px-3 py-2 text-[12px]">
          <span className="text-zinc-400">Exclusões aguardando o PC</span>
          <span className="font-semibold text-zinc-100">{formatNumber(pending)}</span>
        </div>

        {message && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-200">{message}</p>}
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}

        {items.length > 0 && (
          <div className="space-y-2">
            {confirming === null ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => setConfirming('queue')} className="btn-ghost flex-1">
                  Esvaziar (fila para o PC)
                </button>
                <button type="button" onClick={() => setConfirming('purge')} className="btn-danger flex-1">
                  Apagar também do servidor
                </button>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                <p className="text-[12px] leading-relaxed text-red-100">
                  {confirming === 'purge'
                    ? 'Isto remove os arquivos do servidor imediatamente e enfileira a exclusão no PC. Não pode ser desfeito.'
                    : 'Isto apenas enfileira a exclusão. Os arquivos continuam no servidor e no PC até o app confirmar.'}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api.emptyTrash(confirming === 'purge'),
                        confirming === 'purge' ? 'Lixeira esvaziada e arquivos removidos do servidor.' : 'Exclusões enviadas para a fila do PC.',
                      )
                    }
                    className="btn-danger flex-1"
                  >
                    Confirmar
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="btn-ghost flex-1">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-zinc-500">
          A lixeira está vazia.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <li key={item.uuid} className="overflow-hidden rounded-xl border border-ink-700 bg-ink-800">
              <div className="relative aspect-[3/4] bg-ink-900">
                <img src={item.thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover opacity-70" />
                <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-0.5 text-[9px] text-zinc-300">
                  {sqlDate(item.deleted_at)}
                </span>
              </div>
              <div className="flex divide-x divide-ink-700 border-t border-ink-700">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => api.restore(item.uuid), 'Imagem restaurada.')}
                  className="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] text-zinc-300 disabled:opacity-50"
                >
                  <Icon name="restore" className="h-3 w-3" />
                  Restaurar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Remover definitivamente do servidor? O original segue no PC.')) {
                      void run(() => api.purge(item.uuid), 'Removida do servidor.');
                    }
                  }}
                  className="flex flex-1 items-center justify-center gap-1 py-2 text-[10px] text-red-300 disabled:opacity-50"
                >
                  <Icon name="trash" className="h-3 w-3" />
                  Apagar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- tags

function TagsTab() {
  const [items, setItems] = useState<AdminTag[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [categoria, setCategoria] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.adminTags({
          q: appliedSearch || undefined,
          categoria: categoria || undefined,
          pending: pendingOnly,
          limit: 60,
          offset,
        });
        setItems((prev) => (offset === 0 ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Falha ao carregar as tags.');
      } finally {
        setLoading(false);
      }
    },
    [appliedSearch, categoria, pendingOnly],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar tag em inglês ou português…"
            className="w-full py-2.5 pl-9"
            type="search"
          />
        </div>

        <div className="flex items-center gap-2">
          <select value={categoria} onChange={(event) => setCategoria(event.target.value)} className="flex-1 py-2 text-xs">
            <option value="">Todas as categorias</option>
            {CATEGORIES.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPendingOnly((value) => !value)}
            className={`chip shrink-0 ${pendingOnly ? 'chip-on' : ''}`}
          >
            só pendentes
          </button>
        </div>

        <p className="text-[11px] text-zinc-500">{formatNumber(total)} tags</p>
      </div>

      {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}

      <ul className="space-y-2">
        {items.map((tag) => (
          <TagRow
            key={tag.id}
            tag={tag}
            onSaved={() => setItems((prev) => prev.map((item) => (item.id === tag.id ? { ...item, curated: true } : item)))}
          />
        ))}
      </ul>

      {loading && <p className="py-4 text-center text-[11px] text-zinc-500">Carregando…</p>}

      {!loading && items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-zinc-500">
          Nenhuma tag encontrada.
        </p>
      )}

      {items.length > 0 && items.length < total && (
        <button type="button" onClick={() => void load(items.length)} className="btn-ghost w-full">
          Carregar mais
        </button>
      )}
    </div>
  );
}

function TagRow({ tag, onSaved }: { tag: AdminTag; onSaved: () => void }) {
  const [label, setLabel] = useState(tag.pt || tag.en);
  const [cat, setCat] = useState(tag.categoria);
  const [sub, setSub] = useState(tag.sub ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = label !== (tag.pt || tag.en) || cat !== tag.categoria || sub !== (tag.sub ?? '');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateTag(tag.id, { label_pt: label.trim(), categoria: cat, subcategoria: sub.trim() });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="card space-y-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] text-zinc-500">{tag.en}</p>
          <p className="text-[10px] text-zinc-600">
            {formatNumber(tag.usage)} usos · {tag.curated ? 'curada' : 'pendente'}
          </p>
        </div>
        {saved && <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-400" />}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Rótulo em português"
          className="col-span-2 py-2 text-[13px]"
        />
        <select value={cat} onChange={(event) => setCat(event.target.value)} className="py-2 text-[12px]">
          {CATEGORIES.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <input
          value={sub}
          onChange={(event) => setSub(event.target.value)}
          placeholder="subgrupo (opcional)"
          className="py-2 text-[12px]"
        />
      </div>

      {error && <p className="text-[11px] text-red-300">{error}</p>}

      {dirty && (
        <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary w-full py-2 text-[12px]">
          {saving ? 'Salvando…' : 'Salvar tag'}
        </button>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ uploads

function UploadsTab() {
  const [items, setItems] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .uploads()
      .then((data) => setItems(data.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Falha ao carregar os envios.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Últimos envios</h2>
      {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}
      {loading ? (
        <p className="py-4 text-center text-[11px] text-zinc-500">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-zinc-500">
          Nenhum envio registrado ainda.
        </p>
      ) : (
        <ul className="divide-y divide-ink-800 overflow-hidden rounded-2xl border border-ink-700 bg-ink-800">
          {items.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] text-zinc-300">{row.uuid}</p>
                <p className="text-[10px] text-zinc-500">
                  {sqlDate(row.created_at)} · {row.ip} · {formatBytes(row.bytes)} · {row.ms} ms
                </p>
              </div>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${
                  row.action === 'created' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-400'
                }`}
              >
                {row.action === 'created' ? 'novo' : row.action}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- acesso

function AccessTab() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 12) {
      setError('A nova senha precisa ter ao menos 12 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }

    setSaving(true);
    try {
      await api.changePassword(current, password);
      setMessage('Senha alterada. Outras sessões foram encerradas.');
      setCurrent('');
      setPassword('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível trocar a senha.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Trocar senha</h2>
        <p className="mt-1 text-[12px] text-zinc-500">Mínimo de 12 caracteres. As outras sessões serão encerradas.</p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">Senha atual</span>
        <input
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          className="w-full py-2.5"
          required
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">Nova senha</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          minLength={12}
          className="w-full py-2.5"
          required
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">Confirmar nova senha</span>
        <input
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
          className="w-full py-2.5"
          required
        />
      </label>

      {message && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-200">{message}</p>}
      {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}

      <button type="submit" disabled={saving} className="btn-primary w-full">
        {saving ? 'Salvando…' : 'Alterar senha'}
      </button>
    </form>
  );
}
