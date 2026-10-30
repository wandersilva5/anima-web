import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import MetadataSheet from '../components/MetadataSheet';
import SwipeViewer from '../components/SwipeViewer';
import { api, ApiError } from '../lib/api';
import { parseFilters } from '../lib/filters';
import { formatNumber } from '../lib/format';
import type { ImageDetail } from '../lib/types';

/** Mesmo limite padrao usado pelo grid em /api/images. */
const PAGE_SIZE = 48;

export default function Viewer() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();

  const [searchParams] = useSearchParams();
  const query = searchParams.get('s') ?? '';

  const favoritesContext = useMemo(() => parseFilters(new URLSearchParams(query)).fav, [query]);

  const cache = useRef(new Map<string, ImageDetail>());
  const cacheQuery = useRef(query);

  const [detail, setDetail] = useState<ImageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');

  const go = useCallback(
    (target: string) => {
      const search = new URLSearchParams();
      if (query) search.set('s', query);
      setMetaOpen(false);
      setConfirming(false);
      navigate({ pathname: `/i/${target}`, search: search.toString() }, { replace: true });
    },
    [navigate, query],
  );

  const back = useCallback(() => {
    const search = query ? `?${query}` : '';
    navigate({ pathname: favoritesContext ? '/favoritos' : '/', search }, { replace: true });
  }, [favoritesContext, navigate, query]);

  useEffect(() => {
    if (!uuid) return;
    if (cacheQuery.current !== query) {
      cache.current.clear();
      cacheQuery.current = query;
    }
    let alive = true;
    setError(null);
    setConfirming(false);

    const cached = cache.current.get(uuid);
    setDetail(cached ?? null);

    api
      .image(uuid, query, !cached)
      .then((data) => {
        cache.current.set(uuid, data);
        if (alive) setDetail(data);
      })
      .catch((err) => {
        if (!alive) return;
        if (!cached) {
          setError(err instanceof ApiError ? err.message : 'Falha ao carregar a imagem.');
        }
      });

    return () => {
      alive = false;
    };
  }, [uuid, query]);

  // Pre-carrega as vizinhas (+-2 posicoes) para o swipe ficar instantaneo.
  useEffect(() => {
    if (!detail) return;
    const ids = [detail.neighbors.prev, detail.neighbors.next].filter((id): id is string => Boolean(id));
    for (const id of ids) {
      const known = cache.current.get(id);
      if (known) {
        new Image().src = known.urls.display;
        continue;
      }
      api
        .image(id, query, false)
        .then((data) => {
          cache.current.set(id, data);
          new Image().src = data.urls.display;
        })
        .catch(() => undefined);
    }
  }, [detail, query]);

  const toggleFavorite = async () => {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const result = await api.favorite(detail.uuid, !detail.favorite);
      const updated = { ...detail, favorite: result.favorite };
      cache.current.set(detail.uuid, updated);
      setDetail(updated);
    } catch {
      /* ignora: o usuario pode tentar de novo */
    } finally {
      setBusy(false);
    }
  };

  // Gira a imagem no servidor (90 graus) e troca as URLs por versoes novas,
  // para o navegador e o service worker nao mostrarem a imagem antiga.
  const rotateImage = useCallback(
    async (direction: 'cw' | 'ccw') => {
      if (!detail || busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await api.rotate(detail.uuid, direction);
        const updated: ImageDetail = {
          ...detail,
          width: result.width,
          height: result.height,
          urls: result.urls,
        };
        cache.current.set(detail.uuid, updated);
        setDetail(updated);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Nao foi possivel girar a imagem.');
      } finally {
        setBusy(false);
      }
    },
    [busy, detail],
  );

  const askDelete = () => {
    if (!detail || busy) return;
    if (!confirming) {
      setConfirming(true);
      window.setTimeout(() => setConfirming(false), 4000);
      return;
    }
    void removeImage();
  };

  const removeImage = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.softDelete(detail.uuid);
      const next = detail.neighbors.next ?? detail.neighbors.prev;
      cache.current.delete(detail.uuid);
      if (next) {
        go(next);
      } else {
        back();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel mover para a lixeira.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const totalPages = detail ? Math.max(1, Math.ceil(detail.total / PAGE_SIZE)) : 1;

  const goToPage = async () => {
    const page = Number.parseInt(jumpValue, 10);
    if (!Number.isFinite(page) || page < 1 || page > totalPages) return;
    try {
      const result = await api.images(`${query}${query ? '&' : ''}limit=${PAGE_SIZE}`, `o:${(page - 1) * PAGE_SIZE}`);
      const target = result.items[0]?.uuid;
      setJumpOpen(false);
      setJumpValue('');
      if (target) go(target);
    } catch {
      setError('Nao foi possivel pular para a pagina.');
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (!detail) return;

      if (event.key === 'ArrowLeft' && detail.neighbors.prev) {
        go(detail.neighbors.prev);
      } else if (event.key === 'ArrowRight' && detail.neighbors.next) {
        go(detail.neighbors.next);
      } else if (event.key === 'Escape') {
        if (metaOpen) setMetaOpen(false);
        else back();
      } else if (event.key === 'm' || event.key === 'M') {
        setMetaOpen((value) => !value);
      } else if (event.key === 'r') {
        void rotateImage('cw');
      } else if (event.key === 'R') {
        void rotateImage('ccw');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [back, detail, go, metaOpen, rotateImage]);

  return (
    <div className="fixed inset-0 flex flex-col bg-ink-950">
      <div className="relative flex-1 overflow-hidden">
        {detail ? (
          <SwipeViewer
            key={detail.uuid}
            src={detail.urls.display}
            alt={detail.filename}
            onPrev={detail.neighbors.prev ? () => go(detail.neighbors.prev as string) : undefined}
            onNext={detail.neighbors.next ? () => go(detail.neighbors.next as string) : undefined}
            onClose={back}
            onTap={() => setChrome((value) => !value)}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            {error ? (
              <div className="max-w-xs space-y-3 px-6 text-center">
                <Icon name="image" className="mx-auto h-8 w-8 text-zinc-600" />
                <p className="text-sm text-zinc-400">{error}</p>
                <button type="button" onClick={back} className="btn-ghost">
                  Voltar para a galeria
                </button>
              </div>
            ) : (
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-ink-600 border-t-accent" />
            )}
          </div>
        )}

        {chrome && (
          <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 to-transparent pb-8">
            <div className="pointer-events-auto flex items-center gap-2 px-2 py-2">
              <button
                type="button"
                onClick={back}
                className="grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white active:bg-black/60"
                aria-label="Voltar"
              >
                <Icon name="back" className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setJumpValue(String(detail?.position ?? 1));
                  setJumpOpen(true);
                }}
                className="rounded-full bg-black/40 px-3 py-1.5 text-[12px] text-white/90 active:bg-black/60"
              >
                {detail?.position ? formatNumber(detail.position) : '—'}
                <span className="text-white/50"> / {formatNumber(detail?.total ?? 0)}</span>
              </button>

              <button
                type="button"
                onClick={() => void rotateImage('ccw')}
                disabled={busy}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/40 text-white active:bg-black/60 disabled:opacity-40"
                aria-label="Girar para a esquerda"
                title="Girar para a esquerda (Shift+R)"
              >
                <Icon name="rotate" className="h-5 w-5 -scale-x-100" />
              </button>

              <button
                type="button"
                onClick={() => void rotateImage('cw')}
                disabled={busy}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/40 text-white active:bg-black/60 disabled:opacity-40"
                aria-label="Girar para a direita"
                title="Girar para a direita (R)"
              >
                <Icon name="rotate" className="h-5 w-5" />
              </button>

              <span className="truncate text-[11px] text-white/50">{detail?.model ?? ''}</span>
            </div>
          </div>
        )}

        {jumpOpen && (
          <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-ink-700 bg-ink-900/98 p-3">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={totalPages}
              value={jumpValue}
              onChange={(event) => setJumpValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void goToPage();
              }}
              placeholder={`1 a ${totalPages}`}
              className="w-24 py-2"
            />
            <button type="button" onClick={() => void goToPage()} className="btn-primary flex-1 py-2">
              Ir para pagina
            </button>
            <button
              type="button"
              onClick={() => setJumpOpen(false)}
              className="btn-ghost px-3 py-2"
              aria-label="Fechar"
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        )}

        {error && detail && (
          <p className="absolute inset-x-3 bottom-3 z-30 rounded-xl border border-red-500/30 bg-red-950/90 px-3 py-2 text-[12px] text-red-100">
            {error}
          </p>
        )}
      </div>

      {chrome && detail && (
        <div className="safe-bottom z-20 border-t border-ink-800 bg-ink-900/95 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-stretch">
            <button
              type="button"
              onClick={() => void toggleFavorite()}
              disabled={busy}
              className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] disabled:opacity-50"
              aria-pressed={detail.favorite}
            >
              <Icon
                name="heart"
                filled={detail.favorite}
                className={`h-5 w-5 ${detail.favorite ? 'text-rose-400' : 'text-zinc-400'}`}
              />
              <span className={detail.favorite ? 'text-rose-300' : 'text-zinc-500'}>
                {detail.favorite ? 'Favorita' : 'Favoritar'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMetaOpen(true)}
              className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] text-zinc-500"
            >
              <Icon name="info" className="h-5 w-5 text-zinc-400" />
              Metadados
            </button>

            <a
              href={detail.urls.orig}
              download={detail.filename}
              className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] text-zinc-500"
            >
              <Icon name="download" className="h-5 w-5 text-zinc-400" />
              Original
            </a>

            <button
              type="button"
              onClick={askDelete}
              disabled={busy}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] disabled:opacity-50 ${
                confirming ? 'text-red-300' : 'text-zinc-500'
              }`}
            >
              <Icon name="trash" className={`h-5 w-5 ${confirming ? 'text-red-400' : 'text-zinc-400'}`} />
              {confirming ? 'Confirmar?' : 'Excluir'}
            </button>
          </div>

          {confirming && (
            <p className="border-t border-ink-800 px-4 py-2 text-center text-[11px] leading-relaxed text-zinc-400">
              A imagem vai para a lixeira. O arquivo original continua no PC ate voce esvaziar a lixeira.
            </p>
          )}
        </div>
      )}

      {metaOpen && detail && (
        <MetadataSheet
          detail={detail}
          onClose={() => setMetaOpen(false)}
          onTagClick={() => setMetaOpen(false)}
        />
      )}
    </div>
  );
}
