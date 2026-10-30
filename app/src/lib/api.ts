import type {
  AdminTag,
  Dictionary,
  Facets,
  ImageDetail,
  ImageList,
  Me,
  Stats,
  TrashItem,
  UploadRow,
} from './types';

let csrf = '';

export function setCsrf(value: string): void {
  csrf = value;
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (csrf) {
    headers.set('X-CSRF-Token', csrf);
  }

  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: { code?: string; message?: string } };
    throw new ApiError(
      payload.error?.code ?? `http_${response.status}`,
      payload.error?.message ?? 'Falha na requisicao.',
      response.status,
    );
  }

  return data as T;
}

const jsonBody = (data: unknown) => JSON.stringify(data);

export const api = {
  me: () => request<Me>('/api/auth/me'),

  login: (username: string, password: string) =>
    request<{ user: { id: number; username: string }; csrf: string }>('/api/auth/login', {
      method: 'POST',
      body: jsonBody({ username, password }),
    }),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  images: (query: string, cursor?: string | null) => {
    const params = new URLSearchParams(query);
    if (cursor) params.set('cursor', cursor);
    return request<ImageList>(`/api/images?${params.toString()}`);
  },

  image: (uuid: string, query = '', view = false) => {
    const params = new URLSearchParams(query);
    if (view) params.set('view', '1');
    const suffix = params.toString();
    return request<ImageDetail>(`/api/images/${uuid}${suffix ? `?${suffix}` : ''}`);
  },

  facets: (query: string) => request<Facets>(`/api/facets?${query}`),

  dictionary: () => request<Dictionary>('/api/dictionary'),

  stats: () => request<Stats>('/api/stats'),

  favorite: (uuid: string, value?: boolean) =>
    request<{ uuid: string; favorite: boolean }>(`/api/images/${uuid}/favorite`, {
      method: 'POST',
      body: jsonBody(value === undefined ? {} : { value }),
    }),

  softDelete: (uuid: string) =>
    request<{ uuid: string; deleted: boolean }>(`/api/images/${uuid}/delete`, { method: 'POST' }),

  rotate: (uuid: string, direction: 'cw' | 'ccw') =>
    request<{ uuid: string; width: number; height: number; urls: { orig: string; display: string; thumb: string } }>(
      `/api/images/${uuid}/rotate`,
      { method: 'POST', body: jsonBody({ direction }) },
    ),

  trash: () => request<{ items: TrashItem[]; pending_local: number }>('/api/admin/trash'),

  restore: (uuid: string) =>
    request<{ uuid: string }>(`/api/admin/images/${uuid}/restore`, { method: 'POST' }),

  purge: (uuid: string) =>
    request<{ uuid: string }>(`/api/admin/images/${uuid}/purge`, { method: 'POST' }),

  emptyTrash: (purgeRemote: boolean) =>
    request<{ queued: number; purged: number }>('/api/admin/trash/empty', {
      method: 'POST',
      body: jsonBody({ purge_remote: purgeRemote }),
    }),

  adminTags: (params: { q?: string; categoria?: string; pending?: boolean; limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.categoria) search.set('categoria', params.categoria);
    if (params.pending) search.set('pending', '1');
    if (params.limit) search.set('limit', String(params.limit));
    if (params.offset) search.set('offset', String(params.offset));
    return request<{ items: AdminTag[]; total: number }>(`/api/admin/tags?${search.toString()}`);
  },

  updateTag: (id: number, data: { label_pt: string; categoria: string; subcategoria?: string }) =>
    request<{ ok: true }>(`/api/admin/tags/${id}`, { method: 'POST', body: jsonBody(data) }),

  uploads: () => request<{ items: UploadRow[] }>('/api/admin/uploads'),

  rotateSyncToken: () => request<{ token: string }>('/api/admin/sync-token', { method: 'POST' }),

  changePassword: (current: string, password: string) =>
    request<{ ok: true }>('/api/admin/password', { method: 'POST', body: jsonBody({ current, password }) }),

  settings: () => request<{ settings: Record<string, string> }>('/api/admin/settings'),

  saveSettings: (data: { site_name?: string; page_limit?: number; privacy_blur?: boolean }) =>
    request<{ ok: true }>('/api/admin/settings', { method: 'POST', body: jsonBody(data) }),
};
