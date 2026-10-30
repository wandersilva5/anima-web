import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * Estado local do sincronizador: o que ja subiu e com qual hash.
 * Guardado em JSON (6.026 entradas ~ 1 MB) para nao depender de modulo nativo.
 */
export interface StateEntry {
  sha256: string;
  size: number;
  mtimeMs: number;
  uploadedAt: string;
}

interface StateFile {
  version: number;
  lastSync: string | null;
  entries: Record<string, StateEntry>;
}

export class StateStore {
  private data: StateFile;
  private dirty = false;

  constructor(private readonly file: string) {
    this.data = { version: 1, lastSync: null, entries: {} };
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StateFile>;
      if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
        this.data = {
          version: parsed.version ?? 1,
          lastSync: parsed.lastSync ?? null,
          entries: parsed.entries,
        };
      }
    } catch {
      // arquivo corrompido: recomeca (tudo sera reenviado, sem duplicar no servidor)
      this.data = { version: 1, lastSync: null, entries: {} };
    }
  }

  get size(): number {
    return Object.keys(this.data.entries).length;
  }

  get lastSync(): string | null {
    return this.data.lastSync;
  }

  get(uuid: string): StateEntry | undefined {
    return this.data.entries[uuid];
  }

  set(uuid: string, entry: StateEntry): void {
    this.data.entries[uuid] = entry;
    this.dirty = true;
  }

  remove(uuid: string): void {
    if (this.data.entries[uuid]) {
      delete this.data.entries[uuid];
      this.dirty = true;
    }
  }

  touch(): void {
    this.data.lastSync = new Date().toISOString();
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.data)}\n`, 'utf8');
    renameSync(temp, this.file);
    this.dirty = false;
  }
}
