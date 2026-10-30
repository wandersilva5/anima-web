import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import FiltersSheet from '../components/FiltersSheet';
import { Icon } from '../components/Icon';
import ImageGrid from '../components/ImageGrid';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { Filters } from '../lib/filters';
import { activeFilterCount, filtersToSearch, parseFilters, sortLabel } from '../lib/filters';
import { formatNumber } from '../lib/format';
import type { Facets, ImageItem, Sort } from '../lib/types';

interface Props {
  forceFavorites?: boolean;
}

export default function Gallery({ forceFavorites = false }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { me } = useAuth();

  const filters = useMemo<Filters>(() => {
    const parsed = parseFilters(searchParams);
    return forceFavorites ? { ...parsed, fav: true } : parsed;
  }, [searchParams, forceFavorites]);

  const query = useMemo(() => filtersToSearch(filters), [filters]);

  const [items, setItems] = useState<ImageItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [tagLabels, setTagLabels] = useState<Record<number, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [searchText, setSearchText] = useState(filters.q ?? '');
  const sentinel = useRef<HTMLDivElement>(null);

  const update = useCallback(
    (value: Filters) => {
      const nextFilters = forceFavorites ? { ...value, fav: true } : value;
      setSearchParams(new URLSearchParams(filtersToSearch(nextFilters)), { replace: true });
    },
    [forceFavorites, setSearchParams],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    api
      .images(query)
      .then((result) => {
        if (!alive) return;
        setItems(result.items);
        setNext(result.next);
        setTotal(result.total);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Falha ao carregar as imagens.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    api.facets(query).then((data) => alive && setFacets(data)).catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [query]);

  useEffect(() => {
    api
      .dictionary()
      .then((data) => {
        const map: Record<number, string> = {};
        for (const tag of data.tags) map[tag.id] = tag.pt;
        setTagLabels(map);
      })
      .catch(() => undefined);
  }, []);

  const loadMore = useCallback(async () => {
    if (!next || loading || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.images(query, next);
      setItems((prev) => [...prev, ...result.items]);
      setNext(result.next);
      setTotal(result.total);
    } catch {
      /* silencioso: o sentinela tenta de novo */
    } finally {
      setLoadingMore(false);
    }
  }, [next, query, loading, loadingMore]);

  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '700px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loadMore]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = searchText.trim();
      if (value !== (filters.q ?? '')) {
        update({ ...filters, q: value || null });
      }
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  useEffect(() => {
    if ((filters.q ?? '') !== searchText.trim()) {
      setSearchText(filters.q ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  const activeCount = activeFilterCount(filters);
  const blurred = (me?.settings.privacy_blur ?? false) && !revealed;
  const selectedTags = filters.tags.map((id) => ({ id, label: tagLabels[id] ?? `#${id}` }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Buscar tag, prompt ou LoRA…"
            className="w-full py-2.5 pl-9 pr-9"
            type="search"
            enterKeyHint="search"
          />
          {searchText !== '' && (
            <button
              type="button"
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-500"
              aria-label="Limpar busca"
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-ink-600 bg-ink-800"
          aria-label="Abrir filtros"
        >
          <Icon name="filter" className="h-5 w-5" />
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{loading ? 'Carregando…' : `${formatNumber(total)} imagens`}</span>
        <label className="flex items-center gap-1.5">
          <Icon name="shuffle" className="h-3.5 w-3.5" />
          <select
            value={filters.sort}
            onChange={(event) => {
              const sort = event.target.value as Sort;
              update({ ...filters, sort, seed: sort === 'aleatorio' ? Math.floor(Math.random() * 999999) + 1 : 1 });
            }}
            className="border-0 bg-transparent py-1 pl-0 pr-6 text-xs text-zinc-300"
          >
            {(['recentes', 'antigos', 'aleatorio', 'favoritos'] as Sort[]).map((sort) => (
              <option key={sort} value={sort} className="bg-ink-800">
                {sortLabel(sort)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(selectedTags.length > 0 || filters.model || filters.lora || filters.categoria || filters.de || filters.ate) && (
        <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
          {selectedTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => update({ ...filters, tags: filters.tags.filter((id) => id !== tag.id) })}
              className="chip chip-on shrink-0 capitalize"
            >
              {tag.label}
              <Icon name="close" className="h-3 w-3" />
            </button>
          ))}
          {filters.model && (
            <button type="button" onClick={() => update({ ...filters, model: null })} className="chip chip-on shrink-0">
              modelo
              <Icon name="close" className="h-3 w-3" />
            </button>
          )}
          {filters.lora && (
            <button type="button" onClick={() => update({ ...filters, lora: null })} className="chip chip-on shrink-0">
              LoRA
              <Icon name="close" className="h-3 w-3" />
            </button>
          )}
          {filters.de && (
            <button type="button" onClick={() => update({ ...filters, de: null })} className="chip chip-on shrink-0">
              desde {filters.de}
              <Icon name="close" className="h-3 w-3" />
            </button>
          )}
          {filters.ate && (
            <button type="button" onClick={() => update({ ...filters, ate: null })} className="chip chip-on shrink-0">
              até {filters.ate}
              <Icon name="close" className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              update({
                ...filters,
                tags: [],
                categoria: null,
                model: null,
                lora: null,
                q: null,
                de: null,
                ate: null,
              })
            }
            className="chip shrink-0 text-zinc-400"
          >
            limpar
          </button>
        </div>
      )}

      {(me?.settings.privacy_blur ?? false) && (
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-700 bg-ink-800 py-2 text-[12px] text-zinc-400"
        >
          <Icon name="eye-off" className="h-4 w-4" />
          {revealed ? 'Borrar imagens novamente' : 'Modo privacidade ativo — toque para mostrar'}
        </button>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>
      )}

      {loading && items.length === 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="skeleton aspect-[3/4] rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink-700 px-6 py-14 text-center">
          <Icon name="image" className="h-8 w-8 text-zinc-600" />
          <p className="text-sm text-zinc-400">
            {forceFavorites ? 'Nenhuma imagem favorita ainda.' : 'Nenhuma imagem encontrada com esses filtros.'}
          </p>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => update({ ...filters, tags: [], categoria: null, model: null, lora: null, q: null, de: null, ate: null })}
              className="btn-ghost"
            >
              Limpar filtros
            </button>
          )}
          {!forceFavorites && activeCount === 0 && (
            <p className="text-[12px] text-zinc-600">
              Use o app Anima Gallery Sync no PC para enviar as imagens do histórico.
            </p>
          )}
        </div>
      ) : (
        <ImageGrid items={items} query={query} blurred={blurred} onReveal={() => setRevealed(true)} />
      )}

      <div ref={sentinel} className="h-10" />
      {loadingMore && <p className="pb-2 text-center text-[11px] text-zinc-500">Carregando mais…</p>}

      <FiltersSheet
        open={sheetOpen}
        filters={filters}
        facets={facets}
        onClose={() => setSheetOpen(false)}
        onChange={update}
      />
    </div>
  );
}
