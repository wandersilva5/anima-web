import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ApiError, SyncApi } from './api';
import { loadConfig, saveConfig } from './config';
import { pool, retry } from './queue';
import { scan, isUuid } from './scanner';
import { StateStore } from './state';
import { moveToTrash } from './trash';
import type { DeletionItem, LocalPreview, Progress, SyncConfig, SyncStats, SyncSummary } from './types';

const PLAN_BATCH = 400;
const STATE_FLUSH_EVERY = 25;
const LOG_LIMIT = 400;

let mainWindow: BrowserWindow | null = null;
let stateStore: StateStore | null = null;
let running = false;
let cancelRequested = false;

const logs: string[] = [];

// ------------------------------------------------------------------ helpers

function ensureState(): StateStore {
  if (!stateStore) {
    stateStore = new StateStore(join(app.getPath('userData'), 'state.json'));
  }
  return stateStore;
}

function log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  // Hora local (igual ao renderer): o log nao pode misturar UTC com local.
  const line = `${new Date().toTimeString().slice(0, 8)} ${message}`;
  logs.unshift(line);
  if (logs.length > LOG_LIMIT) logs.length = LOG_LIMIT;
  mainWindow?.webContents.send('log', { message: line, level });
}

function emit(progress: Progress): void {
  mainWindow?.webContents.send('progress', progress);
}

function emptyProgress(phase: Progress['phase'], message: string): Progress {
  return { phase, message, scanned: 0, hashed: 0, total: 0, done: 0, failed: 0, bytes: 0, bytesTotal: 0 };
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk as Buffer));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function requireRemote(): SyncConfig {
  const config = loadConfig();
  if (!config.baseUrl) throw new Error('Informe a URL do site nas configuracoes.');
  if (!config.token) throw new Error('Informe o token de sincronizacao (Admin > Painel).');
  return config;
}

function requireConfig(): SyncConfig {
  const config = requireRemote();
  if (!config.historyDir || !existsSync(config.historyDir)) {
    throw new Error(`Pasta history nao encontrada: ${config.historyDir}`);
  }
  return config;
}

// --------------------------------------------------------------- sincronizar

async function runSync(dryRun: boolean): Promise<SyncSummary> {
  if (running) throw new Error('Ja existe uma sincronizacao em andamento.');
  const config = requireConfig();

  running = true;
  cancelRequested = false;
  const startedAt = Date.now();
  const api = new SyncApi(config.baseUrl, config.token);
  const state = ensureState();

  let scanned = 0;
  let uploaded = 0;
  let failed = 0;
  let bytes = 0;
  let total = 0;
  let done = 0;
  let hashed = 0;

  try {
    log(`Varrendo ${config.historyDir}`);
    emit(emptyProgress('scan', 'Varrendo a pasta history…'));
    const items = await scan(
      config.historyDir,
      (count) => {
        scanned = count;
        emit({ ...emptyProgress('scan', 'Varrendo a pasta history…'), scanned: count });
      },
      () => cancelRequested,
    );

    if (cancelRequested) {
      emit(emptyProgress('cancelled', 'Sincronizacao cancelada.'));
      return { scanned, changed: 0, missing: 0, uploaded: 0, failed: 0, bytes: 0, elapsedMs: Date.now() - startedAt };
    }

    // 1) Hasheia so quem e novo ou mudou desde o ultimo envio.
    const byUuid = new Map(items.map((item) => [item.uuid, item]));
    const changed = items.filter((item) => {
      const entry = state.get(item.uuid);
      if (!entry) return true;
      return entry.mtimeMs !== item.mtimeMs || entry.size !== item.size;
    });
    log(`${items.length} geracoes encontradas, ${changed.length} novas ou alteradas.`);

    const hashes = new Map<string, string>();

    await pool(
      changed,
      2,
      async (item) => {
        if (cancelRequested) return;
        try {
          const sha = await hashFile(item.imagePath);
          hashes.set(item.uuid, sha);
        } catch (error) {
          failed++;
          log(`Falha ao ler ${item.imageName}: ${(error as Error).message}`, 'error');
        }
        hashed++;
        emit({ ...emptyProgress('hash', 'Calculando verificacao (SHA-256)…'), scanned: items.length, hashed, total: changed.length });
      },
      () => cancelRequested,
    );

    if (cancelRequested) {
      state.flush();
      emit(emptyProgress('cancelled', 'Sincronizacao cancelada.'));
      return { scanned, changed: changed.length, missing: 0, uploaded, failed, bytes, elapsedMs: Date.now() - startedAt };
    }

    // 2) Pergunta ao servidor o que realmente falta (idempotente por sha256/uuid).
    const payload = changed
      .filter((item) => hashes.has(item.uuid))
      .map((item) => ({ uuid: item.uuid, sha256: hashes.get(item.uuid) as string }));

    emit({ ...emptyProgress('plan', 'Consultando o servidor…'), scanned: items.length, hashed });

    const missing: { uuid: string; sha256: string }[] = [];
    for (const batch of chunk(payload, PLAN_BATCH)) {
      if (cancelRequested) break;
      const result = await retry(
        () => api.plan(batch),
        (error) => error instanceof ApiError && error.retryable,
      );
      missing.push(...result.missing);
      for (const uuid of result.known) {
        const item = byUuid.get(uuid);
        if (item) {
          state.set(uuid, {
            sha256: hashes.get(uuid) ?? '',
            size: item.size,
            mtimeMs: item.mtimeMs,
            uploadedAt: new Date().toISOString(),
          });
        }
      }
      state.flush();
    }

    total = missing.length;
    const bytesTotal = missing.reduce((sum, entry) => sum + (byUuid.get(entry.uuid)?.size ?? 0), 0);

    log(`Servidor precisa de ${total} imagem(ns).`);
    emit({ ...emptyProgress('plan', `${total} imagem(ns) para enviar.`), scanned: items.length, total, bytesTotal });

    // 3) Envia.
    if (total > 0 && !dryRun) {
      await pool(
        missing,
        config.concurrency,
        async (entry) => {
          if (cancelRequested) return;
          const item = byUuid.get(entry.uuid);
          if (!item) {
            failed++;
            done++;
            return;
          }
          try {
            const result = await retry(
              () => api.upload(item, entry.sha256),
              (error) => error instanceof ApiError && error.retryable,
            );
            state.set(item.uuid, {
              sha256: entry.sha256,
              size: item.size,
              mtimeMs: item.mtimeMs,
              uploadedAt: new Date().toISOString(),
            });
            uploaded++;
            bytes += item.size;
            if (uploaded % STATE_FLUSH_EVERY === 0) state.flush();
            if (result.status === 'already_exists') log(`${item.uuid} ja existia no servidor.`);
          } catch (error) {
            failed++;
            log(`Falha ao enviar ${item.uuid}: ${(error as Error).message}`, 'error');
          }
          done++;
          emit({
            ...emptyProgress('upload', `Enviando ${done}/${total}…`),
            scanned: items.length,
            hashed: hashes.size,
            total,
            done,
            failed,
            bytes,
            bytesTotal,
          });
        },
        () => cancelRequested,
      );
    }

    state.touch();
    state.flush();

    const summary: SyncSummary = {
      scanned: items.length,
      changed: changed.length,
      missing: total,
      uploaded,
      failed,
      bytes,
      elapsedMs: Date.now() - startedAt,
    };

    if (cancelRequested) {
      emit({ ...emptyProgress('cancelled', 'Sincronizacao cancelada.'), done, failed, bytes, bytesTotal });
    } else {
      emit({
        ...emptyProgress('done', dryRun ? 'Simulacao concluida.' : 'Sincronizacao concluida.'),
        scanned: items.length,
        hashed: hashes.size,
        total,
        done,
        failed,
        bytes,
        bytesTotal,
      });
      log(
        dryRun
          ? `Simulacao: ${total} pendente(s) de ${items.length}.`
          : `Concluido: ${uploaded} enviada(s), ${failed} falha(s).`,
      );
    }

    return summary;
  } finally {
    running = false;
    cancelRequested = false;
  }
}

// ----------------------------------------------------------------- exclusoes

async function listDeletions(): Promise<DeletionItem[]> {
  const config = requireConfig();
  return new SyncApi(config.baseUrl, config.token).deletions();
}

async function applyDeletions(ids: number[]): Promise<{ moved: number; failed: number }> {
  const config = loadConfig();
  if (!config.baseUrl || !config.token) throw new Error('Configure a URL do site e o token.');
  if (!config.historyDir || !config.trashDir) throw new Error('Configure a pasta history e a lixeira local.');

  const api = new SyncApi(config.baseUrl, config.token);
  const pending = await api.deletions();
  const selected = pending.filter((item) => ids.includes(item.id));

  let moved = 0;
  let failed = 0;

  for (const entry of selected) {
    if (cancelRequested) break;
    try {
      const target = await moveToTrash(config.historyDir, config.trashDir, entry.folder || entry.uuid);
      ensureState().remove(entry.uuid);
      await api.ack(entry.id, 'acked');
      moved++;
      log(`Pasta movida para ${target}`);
    } catch (error) {
      failed++;
      log(`Falha ao excluir ${entry.uuid}: ${(error as Error).message}`, 'error');
      try {
        await api.ack(entry.id, 'failed');
      } catch {
        // o servidor mantem a pendencia para a proxima tentativa
      }
    }
  }

  emit({ ...emptyProgress('deletions', `${moved} pasta(s) movida(s) para a lixeira local.`), done: moved, failed });
  return { moved, failed };
}

// -------------------------------------------------------------------- painel

/** Numeros do servidor de producao (nenhuma imagem e baixada) + latencia. */
async function fetchStats(): Promise<SyncStats & { latency_ms: number }> {
  const config = requireRemote();
  const api = new SyncApi(config.baseUrl, config.token);
  const started = Date.now();
  const stats = await api.stats();
  return { ...stats, latency_ms: Date.now() - started };
}

/** Varre a pasta history e compara com o estado local do ultimo envio. */
async function localPreview(): Promise<LocalPreview> {
  const config = loadConfig();
  if (!config.historyDir || !existsSync(config.historyDir)) {
    throw new Error(`Pasta history nao encontrada: ${config.historyDir || '(nao configurada)'}`);
  }

  const state = ensureState();
  const items = await scan(config.historyDir, () => undefined, () => false);

  let synced = 0;
  let changed = 0;
  let bytes = 0;
  for (const item of items) {
    const entry = state.get(item.uuid);
    if (entry && entry.size === item.size && entry.mtimeMs === item.mtimeMs) {
      synced++;
    } else {
      changed++;
      bytes += item.size;
    }
  }

  return { local: items.length, synced, changed, bytes, lastSync: state.lastSync, stateCount: state.size };
}

// -------------------------------------------------------------------- janela

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 790,
    minWidth: 860,
    minHeight: 640,
    backgroundColor: '#0b0d10',
    title: 'Anima - Painel de sincronizacao',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    stateCount: ensureState().size,
    lastSync: ensureState().lastSync,
    logs: logs.slice(0, 60),
  }));

  ipcMain.handle('config:get', () => loadConfig());

  ipcMain.handle('config:save', (_event, config: SyncConfig) => {
    const saved = saveConfig(config);
    log('Configuracoes salvas.');
    return saved;
  });

  ipcMain.handle('config:ping', async (_event, payload: { baseUrl: string; token: string }) => {
    const api = new SyncApi(payload.baseUrl, payload.token);
    const info = await api.ping();
    log(`Servidor conectado (versao ${info.version}, ${info.images} imagens).`);
    return info;
  });

  ipcMain.handle('dialog:pickDir', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: defaultPath && existsSync(defaultPath) ? defaultPath : undefined,
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('server:stats', () => fetchStats());
  ipcMain.handle('local:preview', () => localPreview());

  ipcMain.handle('sync:start', async () => runSync(false));
  ipcMain.handle('sync:dryRun', async () => runSync(true));
  ipcMain.handle('sync:cancel', () => {
    cancelRequested = true;
    log('Cancelamento solicitado.', 'warn');
    return true;
  });

  ipcMain.handle('deletions:list', () => listDeletions());
  ipcMain.handle('deletions:apply', (_event, ids: number[]) => applyDeletions(ids));

  // Miniatura local da pasta prestes a ser excluida (sem enviar o arquivo ao renderer).
  ipcMain.handle('deletions:thumb', async (_event, uuid: string) => {
    if (!isUuid(uuid)) return null;
    const config = loadConfig();
    const folder = join(config.historyDir, uuid);
    if (!existsSync(folder)) return null;
    try {
      const files = await fs.readdir(folder);
      const image = files.find((name) => /\.(png|jpe?g|webp)$/i.test(name));
      if (!image) return null;
      const bitmap = nativeImage.createFromPath(join(folder, image));
      if (bitmap.isEmpty()) return null;
      return bitmap.resize({ width: 160 }).toDataURL();
    } catch {
      return null;
    }
  });

  ipcMain.handle('shell:openPath', async (_event, target: string) => {
    if (target && existsSync(target)) await shell.openPath(target);
    return true;
  });
}

// ----------------------------------------------------------------- startup

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    ensureState();
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    stateStore?.flush();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    stateStore?.flush();
  });
}

// Evita que um erro nao tratado feche a janela sem explicacao.
process.on('unhandledRejection', (reason) => {
  log(`Erro inesperado: ${String(reason)}`, 'error');
});
