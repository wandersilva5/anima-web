import { promises as fs } from 'node:fs';
import type { DeletionItem, PingInfo, ScanItem, SyncStats } from './types';

const JSON_TIMEOUT_MS = 30_000;
const PING_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 180_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

/** Cliente HTTP da API de sincronizacao (Bearer token). */
export class SyncApi {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    this.base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  private url(path: string): string {
    return new URL(path.replace(/^\/+/, ''), this.base).toString();
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...extra };
  }

  private async fail(response: Response): Promise<never> {
    let code = `http_${response.status}`;
    let message = `O servidor respondeu ${response.status}.`;
    try {
      const payload = (await response.json()) as ErrorPayload;
      if (payload?.error?.code) code = payload.error.code;
      if (payload?.error?.message) message = payload.error.message;
    } catch {
      // resposta sem JSON (HTML de erro do servidor)
    }
    throw new ApiError(response.status, code, message);
  }

  async ping(): Promise<PingInfo> {
    const response = await fetch(this.url('api/sync/ping'), {
      headers: this.headers(),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!response.ok) await this.fail(response);
    return (await response.json()) as PingInfo;
  }

  /** Numeros do acervo remoto: nada e baixado, so contagens. */
  async stats(): Promise<SyncStats> {
    const response = await fetch(this.url('api/sync/stats'), {
      headers: this.headers(),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!response.ok) await this.fail(response);
    return (await response.json()) as SyncStats;
  }

  /** Envia ate 400 pares (uuid, sha256) e recebe o que ainda falta no servidor. */
  async plan(items: { uuid: string; sha256: string }[]): Promise<{ missing: { uuid: string; sha256: string }[]; known: string[] }> {
    const response = await fetch(this.url('api/sync/plan'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
    if (!response.ok) await this.fail(response);
    const payload = (await response.json()) as { missing?: { uuid: string; sha256: string }[]; known?: string[] };
    return { missing: payload.missing ?? [], known: payload.known ?? [] };
  }

  async upload(item: ScanItem, sha256: string): Promise<{ status: string; uuid: string }> {
    const [imageBuffer, metadataRaw] = await Promise.all([
      fs.readFile(item.imagePath),
      fs.readFile(item.metadataPath, 'utf8'),
    ]);

    const form = new FormData();
    form.append('uuid', item.uuid);
    form.append('sha256', sha256);
    form.append('metadata', metadataRaw);
    form.append('image', new Blob([imageBuffer], { type: mimeFor(item.imageName) }), item.imageName);

    const response = await fetch(this.url('api/sync/upload'), {
      method: 'POST',
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) await this.fail(response);
    return (await response.json()) as { status: string; uuid: string };
  }

  async deletions(): Promise<DeletionItem[]> {
    const response = await fetch(this.url('api/sync/deletions'), {
      headers: this.headers(),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
    if (!response.ok) await this.fail(response);
    const payload = (await response.json()) as { items?: DeletionItem[] };
    return payload.items ?? [];
  }

  async ack(id: number, status: 'acked' | 'failed' = 'acked'): Promise<void> {
    const response = await fetch(this.url(`api/sync/deletions/${id}/ack`), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status }),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
    if (!response.ok) await this.fail(response);
  }
}

function mimeFor(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}
