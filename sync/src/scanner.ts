import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, join, relative } from 'node:path';
import type { ScanItem } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function stringToUuid(str: string): string {
  const hex = createHash('md5').update(str).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function makeSyntheticGifItem(filePath: string, baseDir: string, stat: { mtimeMs: number; size: number }): ScanItem {
  const rel = relative(baseDir, filePath).replace(/\\/g, '/');
  const uuid = stringToUuid('gif:' + rel.toLowerCase());
  const fileName = basename(filePath);
  const prompt = basename(filePath, extname(filePath)).replace(/[_-]/g, ' ').trim() || fileName;

  const metadata = {
    params: {
      prompt,
      negativePrompt: '',
      modelName: 'GIF',
    },
    images: [{ filename: fileName }],
    timestamp: Math.round(stat.mtimeMs),
  };

  return {
    uuid,
    folderPath: filePath,
    metadataPath: '',
    metadataContent: JSON.stringify(metadata),
    imagePath: filePath,
    imageName: fileName,
    mtimeMs: Math.round(stat.mtimeMs),
    size: stat.size,
  };
}

/**
 * Le a pasta `history` ou a pasta dedicada a GIFs e devolve as geracoes validas.
 *
 * Para pasta history padrão: varre pastas no formato UUID contendo metadata.json + imagem.
 * Para gifDir dedicado (gifOnly = true): varre arquivos .gif soltos ou em subpastas,
 * gerando UUID e metadata sintético automaticamente quando necessário.
 */
export async function scan(
  historyDir: string,
  onProgress: (scanned: number) => void,
  shouldStop: () => boolean,
  gifOnly = false,
): Promise<ScanItem[]> {
  const items: ScanItem[] = [];
  let visited = 0;

  let entries;
  try {
    entries = await fs.readdir(historyDir, { withFileTypes: true });
  } catch {
    return [];
  }

  // 1) Se for pasta de GIFs (gifOnly), aceita arquivos .gif soltos na raiz da pasta
  if (gifOnly) {
    const gifFiles = entries.filter((e) => e.isFile() && extname(e.name).toLowerCase() === '.gif');
    for (const file of gifFiles) {
      if (shouldStop()) break;
      visited++;
      try {
        const filePath = join(historyDir, file.name);
        const stat = await fs.stat(filePath);
        items.push(makeSyntheticGifItem(filePath, historyDir, stat));
      } catch {
        // ignorar arquivo com erro de leitura
      }
      if (visited % 50 === 0) onProgress(visited);
    }
  }

  // 2) Varredura de subdiretórios
  const dirEntries = entries.filter((e) => e.isDirectory());

  for (const dir of dirEntries) {
    if (shouldStop()) break;
    visited++;

    const folderPath = join(historyDir, dir.name);

    try {
      const files = await fs.readdir(folderPath, { withFileTypes: true });
      const hasMetadata = files.some((file) => file.isFile() && file.name === 'metadata.json');

      if (hasMetadata && isUuid(dir.name)) {
        // Estrutura clássica do Anima: pasta UUID + metadata.json + imagem
        const image = files.find(
          (file) =>
            file.isFile() &&
            IMAGE_EXTENSIONS.has(extname(file.name).toLowerCase()) &&
            (!gifOnly || extname(file.name).toLowerCase() === '.gif'),
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
      } else if (gifOnly) {
        // Subpasta qualquer dentro da pasta de GIFs: varre arquivos .gif
        const subGifs = files.filter((f) => f.isFile() && extname(f.name).toLowerCase() === '.gif');
        for (const subGif of subGifs) {
          const subPath = join(folderPath, subGif.name);
          try {
            const stat = await fs.stat(subPath);
            items.push(makeSyntheticGifItem(subPath, historyDir, stat));
          } catch {
            // ignorar
          }
        }
      }
    } catch {
      // pasta inacessível: segue
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
