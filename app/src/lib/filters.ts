import type { Sort } from './types';

export interface Filters {
  tags: number[];
  mode: 'and' | 'or';
  categoria: string | null;
  model: string | null;
  lora: string | null;
  q: string | null;
  de: string | null;
  ate: string | null;
  fav: boolean;
  sort: Sort;
  seed: number;
}

const SORTS: Sort[] = ['recentes', 'antigos', 'aleatorio', 'favoritos'];

export const emptyFilters: Filters = {
  tags: [],
  mode: 'and',
  categoria: null,
  model: null,
  lora: null,
  q: null,
  de: null,
  ate: null,
  fav: false,
  sort: 'recentes',
  seed: 1,
};

export function parseFilters(search: URLSearchParams): Filters {
  const sort = search.get('sort') as Sort | null;
  const tags = (search.get('tags') ?? '')
    .split(',')
    .map((v) => Number.parseInt(v, 10))
    .filter((v) => Number.isFinite(v) && v > 0);

  return {
    tags,
    mode: search.get('mode') === 'or' ? 'or' : 'and',
    categoria: search.get('categoria') || null,
    model: search.get('model') || null,
    lora: search.get('lora') || null,
    q: search.get('q') || null,
    de: search.get('de') || null,
    ate: search.get('ate') || null,
    fav: search.get('fav') === '1',
    sort: sort && SORTS.includes(sort) ? sort : 'recentes',
    seed: Number.parseInt(search.get('seed') ?? '1', 10) || 1,
  };
}

/** Serializa os filtros (sem "?"). Filtros vazios nao entram na URL. */
export function filtersToSearch(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.tags.length) params.set('tags', filters.tags.join(','));
  if (filters.mode === 'or') params.set('mode', 'or');
  if (filters.categoria) params.set('categoria', filters.categoria);
  if (filters.model) params.set('model', filters.model);
  if (filters.lora) params.set('lora', filters.lora);
  if (filters.q) params.set('q', filters.q);
  if (filters.de) params.set('de', filters.de);
  if (filters.ate) params.set('ate', filters.ate);
  if (filters.fav) params.set('fav', '1');
  if (filters.sort !== 'recentes') params.set('sort', filters.sort);
  if (filters.sort === 'aleatorio') params.set('seed', String(filters.seed));
  return params.toString();
}

export function activeFilterCount(filters: Filters): number {
  let count = filters.tags.length;
  if (filters.model) count++;
  if (filters.lora) count++;
  if (filters.categoria) count++;
  if (filters.de) count++;
  if (filters.ate) count++;
  if (filters.q) count++;
  return count;
}

export function toggleTag(filters: Filters, id: number): Filters {
  const tags = filters.tags.includes(id)
    ? filters.tags.filter((t) => t !== id)
    : [...filters.tags, id];
  return { ...filters, tags };
}

export function sortLabel(sort: Sort): string {
  switch (sort) {
    case 'antigos':
      return 'Mais antigas';
    case 'aleatorio':
      return 'Aleatórias';
    case 'favoritos':
      return 'Favoritas';
    default:
      return 'Mais recentes';
  }
}
