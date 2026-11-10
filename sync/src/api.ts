import { promises as fs } from 'node:fs';
import { app, BrowserWindow, session } from 'electron';
import type { DeletionItem, PingInfo, ScanItem, SyncStats } from './types';

const JSON_TIMEOUT_MS = 30_000;
const PING_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 180_000;

// O WAF do hosting (InfinityFree/LiteSpeed) exige um cookie de verificacao que so
// e gravado quando o JavaScript do desafio (aes.js) roda em um navegador. Como o
// Electron e Chromium, carregamos o site uma vez numa janela oculta + sessao
// persistente para resolver o desafio e reusamos o cookie nas chamadas fetch.
const PARTITION = 'persist:anima-sync';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let cookieHeader = '';
let challengePromise: Promise<void> | null = null;

function ensureChallenge(base: string): Promise<void> {
  if (challengePromise) return challengePromise;
  challengePromise = solveChallenge(base).catch(() => undefined);
  return challengePromise;
}

async function solveChallenge(base: string): Promise<void> {
  if (!app.isReady()) return;

  const origin = new URL(base).origin;
  const ses = session.fromPartition(PARTITION);

  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, images: false },
  });

  try {
    // Endpoint leve: o WAF devolve o desafio, o JS roda e grava o cookie.
    await win.loadURL(new URL('api/health', base).toString(), { userAgent: USER_AGENT });
    // Tempo para o desafio redirecionar (?i=1) e gravar o cookie de verificacao.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  } catch {
    // se falhar, as chamadas seguem e o erro real aparece no ping
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }

  const cookies = await ses.cookies.get({ url: origin });
  cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

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
    return {
      'X-Sync-Token': this.token,
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...extra,
    };
  }

  /** Garante (uma vez) que o cookie do desafio WAF foi obtido antes de chamar a API. */
  private async prepare(): Promise<void> {
    try {
      await ensureChallenge(this.base);
    } catch {
      // segue sem cookie: a mensagem real do servidor aparece na resposta
    }
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
    await this.prepare();
    const response = await fetch(this.url('api/sync/ping'), {
      headers: this.headers(),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!response.ok) await this.fail(response);
    return (await response.json()) as PingInfo;
  }

  /** Numeros do acervo remoto: nada e baixado, so contagens. */
  async stats(): Promise<SyncStats> {
    await this.prepare();
    const response = await fetch(this.url('api/sync/stats'), {
      headers: this.headers(),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!response.ok) await this.fail(response);
    return (await response.json()) as SyncStats;
  }

  /** Envia ate 400 pares (uuid, sha256) e recebe o que ainda falta no servidor. */
  async plan(items: { uuid: string; sha256: string }[]): Promise<{ missing: { uuid: string; sha256: string }[]; known: string[] }> {
    await this.prepare();
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
    await this.prepare();
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
    await this.prepare();
    const response = await fetch(this.url('api/sync/deletions'), {
      headers: this.headers(),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
    if (!response.ok) await this.fail(response);
    const payload = (await response.json()) as { items?: DeletionItem[] };
    return payload.items ?? [];
  }

  async ack(id: number, status: 'acked' | 'failed' = 'acked'): Promise<void> {
    await this.prepare();
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
