import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isUuid } from './scanner';

/** Garante que `child` esta dentro de `root` (protecao contra path traversal). */
export function assertInside(child: string, root: string): void {
  const rel = relative(resolve(root), resolve(child));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Caminho fora da raiz permitida: ${child}`);
  }
}

/**
 * Move a pasta da geracao para a lixeira local, com data.
 * Revalida tudo antes de tocar em qualquer arquivo:
 *  - uuid no formato esperado;
 *  - caminho resolvido dentro da pasta history;
 *  - pasta existe, e uma pasta e contem metadata.json;
 *  - destino ainda nao existe.
 */
export async function moveToTrash(historyDir: string, trashDir: string, uuid: string): Promise<string> {
  if (!isUuid(uuid)) {
    throw new Error(`UUID invalido para exclusao: ${uuid}`);
  }

  const source = resolve(join(historyDir, uuid));
  assertInside(source, historyDir);

  if (source === resolve(historyDir)) {
    throw new Error('Recusando mover a propria pasta history.');
  }

  const stat = await fs.stat(source);
  if (!stat.isDirectory()) {
    throw new Error(`Nao e uma pasta: ${source}`);
  }
  await fs.access(join(source, 'metadata.json'));

  const day = new Date().toISOString().slice(0, 10);
  const target = resolve(join(trashDir, day, uuid));
  assertInside(target, trashDir);

  await fs.mkdir(dirname(target), { recursive: true });
  const alreadyThere = await fs
    .stat(target)
    .then(() => true)
    .catch(() => false);
  if (alreadyThere) {
    throw new Error(`Ja existe uma pasta na lixeira com este UUID: ${target}`);
  }

  try {
    await fs.rename(source, target);
  } catch (error) {
    // volumes diferentes (EXDEV): copia e so entao remove
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') throw error;
    await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
    await fs.rm(source, { recursive: true, force: false });
  }

  return target;
}

/** Apaga definitivamente uma pasta que ja esta na lixeira local. */
export async function purgeFromTrash(trashDir: string, uuid: string): Promise<void> {
  if (!isUuid(uuid)) {
    throw new Error(`UUID invalido: ${uuid}`);
  }
  const today = resolve(join(trashDir, new Date().toISOString().slice(0, 10), uuid));
  assertInside(today, trashDir);
  await fs.rm(today, { recursive: true, force: true });
}
