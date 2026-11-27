import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import type { ScanItem } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Le a pasta `history` e devolve as geracoes validas.
 *
 * Varre pastas no formato UUID contendo metadata.json + imagem.
 */
export async function scan(
  historyDir: string,
  onProgress: (scanned: number) => void,
  shouldStop: () => boolean,
): Promise<ScanItem[]> {
  const items: ScanItem[] = [];
  let visited = 0;

  let entries;
  try {
    entries = await fs.readdir(historyDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirEntries = entries.filter((e) => e.isDirectory());

  for (const dir of dirEntries) {
    if (shouldStop()) break;
    visited++;

    const folderPath = join(historyDir, dir.name);

    try {
      const files = await fs.readdir(folderPath, { withFileTypes: true });
      const hasMetadata = files.some((file) => file.isFile() && file.name === 'metadata.json');

      if (hasMetadata && isUuid(dir.name)) {
        // Estrutura classica do Anima: pasta UUID + metadata.json + imagem
        const image = files.find(
          (file) => file.isFile() && IMAGE_EXTENSIONS.has(extname(file.name).toLowerCase()),
        );
        if (image) {
          const metadataPath = join(folderPath, 'metadata.json');
          const imagePath = join(folderPath, image.name);
          const [metaStat, imageStat] = await Promise.all([fs.stat(metadataPath), fs.stat(imagePath)]);

          items.push({
            uuid: dir.name.toLowerCase(),
            folderPath,
            metadataPath,
            imagePath,
            imageName: image.name,
            mtimeMs: Math.round(Math.max(metaStat.mtimeMs, imageStat.mtimeMs)),
            size: imageStat.size,
          });
        }
      }
    } catch {
      // pasta inacessivel: segue
    }

    if (visited % 50 === 0) onProgress(visited);
  }

  onProgress(visited);
  return items;
}

/** Conta rapidamente quantas pastas e arquivos seriam varridos. */
export async function countFolders(historyDir: string): Promise<number> {
  try {
    const entries = await fs.readdir(historyDir, { withFileTypes: true });
    return entries.length;
  } catch {
    return 0;
  }
}
