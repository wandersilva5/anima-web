/**
 * Executa tarefas assincronas com concorrencia limitada e parada cooperativa.
 */
export async function pool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean,
): Promise<void> {
  const size = Math.max(1, Math.min(8, concurrency));
  let cursor = 0;

  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      if (shouldStop()) return;
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Repete `task` com espera exponencial (3 tentativas: 1 s, 2 s, 4 s).
 * `shouldRetry` decide se o erro merece nova tentativa.
 */
export async function retry<T>(
  task: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !shouldRetry(error)) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}
