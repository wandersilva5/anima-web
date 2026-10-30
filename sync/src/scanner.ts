import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import type { ScanItem } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Le a pasta `history` e devolve as geracoes validas (metadata.json + imagem).
 * Pastas `.thumbs`, arquivos soltos e pastas fora do padrao UUID sao ignoradas.
 */
export async function scan(
  historyDir: string,
  onProgress: (scanned: number) => void,
  shouldStop: () => boolean,
): Promise<ScanItem[]> {
  const entries = await fs.readdir(historyDir, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory() && isUuid(entry.name)).map((entry) => entry.name);

  const items: ScanItem[] = [];
  let visited = 0;

  for (const folder of folders) {
    if (shouldStop()) break;
    visited++;

    try {
      const folderPath = join(historyDir, folder);
      const files = await fs.readdir(folderPath, { withFileTypes: true });

      const hasMetadata = files.some((file) => file.isFile() && file.name === 'metadata.json');
      if (!hasMetadata) continue;

      const image = files.find((file) => file.isFile() && IMAGE_EXTENSIONS.has(extname(file.name).toLowerCase()));
      if (!image) continue;

      const metadataPath = join(folderPath, 'metadata.json');
      const imagePath = join(folderPath, image.name);
      const [metaStat, imageStat] = await Promise.all([fs.stat(metadataPath), fs.stat(imagePath)]);

      items.push({
        uuid: folder.toLowerCase(),
        folderPath,
        metadataPath,
        imagePath,
        imageName: image.name,
        mtimeMs: Math.round(Math.max(metaStat.mtimeMs, imageStat.mtimeMs)),
        size: imageStat.size,
      });
    } catch {
      // pasta removida ou sem permissao durante a varredura: segue adiante
    }

    if (visited % 50 === 0) onProgress(visited);
  }

  onProgress(visited);
  return items;
}

/** Conta rapidamente quantas pastas seriam varridas (para a barra de progresso). */
export async function countFolders(historyDir: string): Promise<number> {
  const entries = await fs.readdir(historyDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && isUuid(entry.name)).length;
}
