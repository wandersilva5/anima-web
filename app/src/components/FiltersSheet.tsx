import { useMemo, useState } from 'react';
import type { Filters } from '../lib/filters';
import { activeFilterCount, toggleTag } from '../lib/filters';
import type { Facets, TagFacet } from '../lib/types';
import { formatNumber } from '../lib/format';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  filters: Filters;
  facets: Facets | null;
  onClose: () => void;
  onChange: (filters: Filters) => void;
}

export default function FiltersSheet({ open, filters, facets, onClose, onChange }: Props) {
  const [tab, setTab] = useState<string>('todas');
  const selected = useMemo(() => new Set(filters.tags), [filters.tags]);

  if (!open) return null;

  const categories = (facets?.categories ?? []).filter((category) => category.tags.length > 0);
  const activeTab = tab === 'todas' ? null : categories.find((category) => category.key === tab) ?? null;
  const activeCount = activeFilterCount(filters);

  const renderTag = (tag: TagFacet) => {
    const on = selected.has(tag.id);
    return (
      <button
        key={tag.id}
        type="button"
        onClick={() => onChange(toggleTag(filters, tag.id))}
        className={`chip ${on ? 'chip-on' : ''}`}
      >
        <span className="capitalize">{tag.pt}</span>
        <span className="text-[10px] text-zinc-500">{formatNumber(tag.count)}</span>
      </button>
    );
  };

  const renderGrouped = (tags: TagFacet[], subs: Record<string, string>) => {
    const groups = new Map<string, TagFacet[]>();
    for (const tag of tags) {
      const key = tag.sub && subs[tag.sub] ? tag.sub : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(tag);
    }
    return Array.from(groups.entries()).map(([sub, list]) => (
      <div key={sub || 'geral'} className="space-y-2">
        {sub !== '' && <h4 className="text-[11px] uppercase tracking-wide text-zinc-500">{subs[sub]}</h4>}
        <div className="flex flex-wrap gap-2">{list.map(renderTag)}</div>
      </div>
    ));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60" onClick={onClose}>
      <div
        className="mt-auto flex max-h-[92vh] animate-slide-up flex-col rounded-t-3xl border-t border-ink-700 bg-ink-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Filtros</h2>
            <p className="text-[11px] text-zinc-500">
              {activeCount === 0 ? 'Nenhum filtro ativo' : `${activeCount} filtro(s) ativo(s)`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...filters,
                  tags: [],
                  categoria: null,
                  model: null,
                  lora: null,
                  de: null,
                  ate: null,
                  q: null,
                })
              }
              className="text-xs text-zinc-400 underline-offset-2 hover:underline"
            >
              Limpar
            </button>
            <button type="button" onClick={onClose} className="rounded-full bg-ink-800 p-2" aria-label="Fechar filtros">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-ink-800 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setTab('todas')}
            className={`chip ${tab === 'todas' ? 'chip-on' : ''}`}
          >
            Todas
          </button>
          {categories.map((category) => (
            <button
              key={category.key}
              type="button"
              onClick={() => setTab(category.key)}
              className={`chip ${tab === category.key ? 'chip-on' : ''}`}
            >
              {category.label}
              <span className="text-[10px] text-zinc-500">{formatNumber(category.count)}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {filters.tags.length > 1 && (
            <div className="flex items-center justify-between rounded-xl bg-ink-800 px-3 py-2">
              <span className="text-xs text-zinc-400">Combinar tags</span>
              <div className="flex gap-1 rounded-lg bg-ink-900 p-1">
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, mode: 'and' })}
                  className={`rounded-md px-2.5 py-1 text-[11px] ${filters.mode === 'and' ? 'bg-accent text-white' : 'text-zinc-400'}`}
                >
                  Todas (E)
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, mode: 'or' })}
                  className={`rounded-md px-2.5 py-1 text-[11px] ${filters.mode === 'or' ? 'bg-accent text-white' : 'text-zinc-400'}`}
                >
                  Qualquer (OU)
                </button>
              </div>
            </div>
          )}

          {activeTab === null ? (
            categories.map((category) => (
              <section key={category.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{category.label}</h3>
                  <button
                    type="button"
                    onClick={() => setTab(category.key)}
                    className="flex items-center gap-1 text-[11px] text-accent-soft"
                  >
                    ver todos <Icon name="right" className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">{category.tags.slice(0, 8).map(renderTag)}</div>
              </section>
            ))
          ) : (
            <div className="space-y-4">
              {renderGrouped(activeTab.tags, activeTab.subs)}
            </div>
          )}

          {(facets?.models.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Modelo</h3>
              <div className="flex flex-wrap gap-2">
                {facets!.models.slice(0, 10).map((model) => {
                  const on = filters.model === String(model.id);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => onChange({ ...filters, model: on ? null : String(model.id) })}
                      className={`chip ${on ? 'chip-on' : ''}`}
                      title={model.name}
                    >
                      {(model.name.split(/[\\/]/).pop() ?? model.name).replace('.safetensors', '')}
                      <span className="text-[10px] text-zinc-500">{formatNumber(model.count)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {(facets?.loras.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">LoRA</h3>
              <div className="flex flex-wrap gap-2">
                {facets!.loras.slice(0, 12).map((lora) => {
                  const on = filters.lora === String(lora.id);
                  return (
                    <button
                      key={lora.id}
                      type="button"
                      onClick={() => onChange({ ...filters, lora: on ? null : String(lora.id) })}
                      className={`chip ${on ? 'chip-on' : ''}`}
                      title={lora.name}
                    >
                      {(lora.name.split(/[\\/]/).pop() ?? lora.name).replace('.safetensors', '')}
                      <span className="text-[10px] text-zinc-500">{formatNumber(lora.count)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Período</h3>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filters.de ?? ''}
                onChange={(event) => onChange({ ...filters, de: event.target.value || null })}
                className="w-full"
              />
              <span className="text-xs text-zinc-500">até</span>
              <input
                type="date"
                value={filters.ate ?? ''}
                onChange={(event) => onChange({ ...filters, ate: event.target.value || null })}
                className="w-full"
              />
            </div>
          </section>

          <section className="flex items-center justify-between rounded-xl bg-ink-800 px-3 py-2.5">
            <span className="text-sm text-zinc-300">Somente favoritas</span>
            <button
              type="button"
              onClick={() => onChange({ ...filters, fav: !filters.fav })}
              className={`relative h-6 w-11 rounded-full transition ${filters.fav ? 'bg-accent' : 'bg-ink-600'}`}
              aria-pressed={filters.fav}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${filters.fav ? 'left-[22px]' : 'left-0.5'}`}
              />
            </button>
          </section>
        </div>

        <div className="safe-bottom border-t border-ink-800 px-4 py-3">
          <button type="button" onClick={onClose} className="btn-primary w-full">
            Ver {formatNumber(facets?.total ?? 0)} imagens
          </button>
        </div>
      </div>
    </div>
  );
}
