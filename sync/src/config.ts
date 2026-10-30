import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SyncConfig } from './types';

const DEFAULT_HISTORY = 'E:\\Anima2000\\anima-electron\\history';
const DEFAULT_TRASH = 'E:\\Anima2000\\_trash';
const DEFAULT_BASE_URL = 'https://femipro.trustchoicereviews.com/';

interface StoredConfig {
  historyDir?: string;
  trashDir?: string;
  baseUrl?: string;
  tokenCipher?: string;
  tokenPlain?: string;
  concurrency?: number;
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

export function defaultConfig(): SyncConfig {
  return {
    historyDir: DEFAULT_HISTORY,
    trashDir: DEFAULT_TRASH,
    baseUrl: DEFAULT_BASE_URL,
    token: '',
    concurrency: 2,
  };
}

export function loadConfig(): SyncConfig {
  const fallback = defaultConfig();
  const file = configPath();
  if (!existsSync(file)) return fallback;

  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as StoredConfig;
    let token = stored.tokenPlain ?? '';
    if (stored.tokenCipher && safeStorage.isEncryptionAvailable()) {
      try {
        token = safeStorage.decryptString(Buffer.from(stored.tokenCipher, 'base64'));
      } catch {
        token = '';
      }
    }
    return {
      historyDir: stored.historyDir ?? fallback.historyDir,
      trashDir: stored.trashDir ?? fallback.trashDir,
      baseUrl: stored.baseUrl ?? '',
      token,
      concurrency: clampConcurrency(stored.concurrency),
    };
  } catch {
    return fallback;
  }
}

export function saveConfig(config: SyncConfig): SyncConfig {
  const normalized: SyncConfig = {
    historyDir: config.historyDir.trim(),
    trashDir: config.trashDir.trim(),
    baseUrl: normalizeUrl(config.baseUrl),
    token: config.token.trim(),
    concurrency: clampConcurrency(config.concurrency),
  };

  const stored: StoredConfig = {
    historyDir: normalized.historyDir,
    trashDir: normalized.trashDir,
    baseUrl: normalized.baseUrl,
    concurrency: normalized.concurrency,
  };

  // O token nunca fica em texto claro quando o cofre do sistema esta disponivel.
  if (normalized.token) {
    if (safeStorage.isEncryptionAvailable()) {
      stored.tokenCipher = safeStorage.encryptString(normalized.token).toString('base64');
    } else {
      stored.tokenPlain = normalized.token;
    }
  }

  const file = configPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

  return normalized;
}

export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.endsWith('/') ? withScheme : `${withScheme}/`;
}

function clampConcurrency(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 2;
  return Math.max(1, Math.min(4, Math.round(value)));
}
