/** Tipos compartilhados entre o processo principal e o renderer. */

export interface SyncConfig {
  /** Pasta `history` do Anima (fonte da verdade). */
  historyDir: string;
  /** Para onde as pastas excluidas sao movidas (retencao local). */
  trashDir: string;
  /** URL do site, ex.: https://femipro.trustchoicereviews.com */
  baseUrl: string;
  /** SYNC_TOKEN gerado no painel Admin. */
  token: string;
  /** Uploads simultaneos. */
  concurrency: number;
}

export interface ScanItem {
  uuid: string;
  folderPath: string;
  metadataPath: string;
  imagePath: string;
  imageName: string;
  /** Maior mtime entre metadata.json e a imagem. */
  mtimeMs: number;
  size: number;
}

export type Phase =
  | 'idle'
  | 'scan'
  | 'hash'
  | 'plan'
  | 'upload'
  | 'deletions'
  | 'done'
  | 'cancelled'
  | 'error';

export interface Progress {
  phase: Phase;
  message: string;
  scanned: number;
  hashed: number;
  total: number;
  done: number;
  failed: number;
  bytes: number;
  bytesTotal: number;
}

export interface DeletionItem {
  id: number;
  uuid: string;
  folder: string;
  requested_at: string;
}

export interface PingInfo {
  ok: boolean;
  version: string;
  php: string;
  max_bytes: number;
  gd_webp: boolean;
  images: number;
  server_time: string;
}

/** Numeros do servidor de producao (nenhuma imagem e baixada). */
export interface SyncStats {
  ok: boolean;
  version: string;
  php: string;
  gd_webp: boolean;
  max_bytes: number;
  server_time: string;
  images: number;
  trashed: number;
  favorites: number;
  bytes: number;
  models: number;
  loras: number;
  tags: number;
  last_image_at: string | null;
  pending_deletions: number;
}

/** Retrato da pasta local comparada com o estado do ultimo envio. */
export interface LocalPreview {
  local: number;
  synced: number;
  changed: number;
  bytes: number;
  lastSync: string | null;
  stateCount: number;
}

export interface SyncSummary {
  scanned: number;
  changed: number;
  missing: number;
  uploaded: number;
  failed: number;
  bytes: number;
  elapsedMs: number;
}
