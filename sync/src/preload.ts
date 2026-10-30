import { contextBridge, ipcRenderer } from 'electron';
import type { DeletionItem, LocalPreview, PingInfo, Progress, SyncConfig, SyncStats, SyncSummary } from './types';

export interface AppInfo {
  version: string;
  userData: string;
  stateCount: number;
  lastSync: string | null;
  logs: string[];
}

/**
 * Ponte segura entre o renderer (HTML puro) e o processo principal.
 * Nada de Node no renderer: so estes metodos.
 */
const bridge = {
  info: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,

  loadConfig: () => ipcRenderer.invoke('config:get') as Promise<SyncConfig>,

  saveConfig: (config: SyncConfig) => ipcRenderer.invoke('config:save', config) as Promise<SyncConfig>,

  ping: (baseUrl: string, token: string) =>
    ipcRenderer.invoke('config:ping', { baseUrl, token }) as Promise<PingInfo>,

  /** Numeros do servidor de producao (nao baixa imagens). */
  stats: () => ipcRenderer.invoke('server:stats') as Promise<SyncStats & { latency_ms: number }>,

  /** Contagem local: quantas geracoes estao pendentes de envio. */
  preview: () => ipcRenderer.invoke('local:preview') as Promise<LocalPreview>,

  pickDir: (current?: string) => ipcRenderer.invoke('dialog:pickDir', current) as Promise<string | null>,

  openPath: (target: string) => ipcRenderer.invoke('shell:openPath', target) as Promise<boolean>,

  sync: () => ipcRenderer.invoke('sync:start') as Promise<SyncSummary>,

  dryRun: () => ipcRenderer.invoke('sync:dryRun') as Promise<SyncSummary>,

  cancel: () => ipcRenderer.invoke('sync:cancel') as Promise<boolean>,

  deletions: () => ipcRenderer.invoke('deletions:list') as Promise<DeletionItem[]>,

  deletionThumb: (uuid: string) => ipcRenderer.invoke('deletions:thumb', uuid) as Promise<string | null>,

  applyDeletions: (ids: number[]) =>
    ipcRenderer.invoke('deletions:apply', ids) as Promise<{ moved: number; failed: number }>,

  onProgress: (callback: (progress: Progress) => void) => {
    const handler = (_event: unknown, progress: Progress) => callback(progress);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },

  onLog: (callback: (entry: { message: string; level: string }) => void) => {
    const handler = (_event: unknown, entry: { message: string; level: string }) => callback(entry);
    ipcRenderer.on('log', handler);
    return () => ipcRenderer.removeListener('log', handler);
  },
};

contextBridge.exposeInMainWorld('syncApi', bridge);

export type SyncBridge = typeof bridge;
