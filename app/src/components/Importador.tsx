import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Icon } from './Icon';
import { formatBytes, formatNumber } from '../lib/format';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const LOTE = 400;
const CONC_HASH = 3;
const CONC_ENVIO = 2;
const TIMEOUT_ENVIO = 180_000;
const CHAVE_CACHE = 'anima-import-sha-v1';
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

type Fase = 'ocioso' | 'hash' | 'plan' | 'upload' | 'concluido' | 'parado' | 'erro';

type Item = { uuid: string; image: File; meta: File };
type CacheSha = Record<string, [number, number, string]>;

const ROTULO: Record<Fase, string> = {
  ocioso: 'Escolha a pasta history e o token para começar.',
  hash: 'Calculando verificacao (SHA-256)...',
  plan: 'Perguntando ao servidor o que falta...',
  upload: 'Enviando imagens...',
  concluido: 'Importacao concluida.',
  parado: 'Parado — execute de novo para continuar de onde parou.',
  erro: 'Interrompido com erro.',
};

interface Estado {
  fase: Fase;
  hasheado: number;
  hashTotal: number;
  lote: number;
  feito: number;
  falhas: number;
  bytes: number;
  bytesTotal: number;
}

const INICIAL: Estado = {
  fase: 'ocioso',
  hasheado: 0,
  hashTotal: 0,
  lote: 0,
  feito: 0,
  falhas: 0,
  bytes: 0,
  bytesTotal: 0,
};

class TokenInvalido extends Error {}

function endpoint(rota: string): string {
  return `${BASE}/api/sync/${rota}`;
}

function lerCache(): CacheSha {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CACHE) ?? '{}') as CacheSha;
  } catch {
    return {};
  }
}

function gravarCache(cache: CacheSha): void {
  try {
    localStorage.setItem(CHAVE_CACHE, JSON.stringify(cache));
  } catch {
    // quota estourada: apenas perde o atalho de hash, nada de correcao
  }
}

async function chamada(token: string, rota: string, init: RequestInit = {}, timeout = 30_000): Promise<Response> {
  return fetch(endpoint(rota), {
    ...init,
    signal: AbortSignal.timeout(timeout),
    headers: { Accept: 'application/json', 'X-Sync-Token': token, Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

async function lerErro(response: Response): Promise<{ code: string; message: string }> {
  let code = `http_${response.status}`;
  let message = `O servidor respondeu ${response.status}.`;
  try {
    const payload = (await response.json()) as { error?: { code?: string; message?: string } };
    if (payload?.error?.code) code = payload.error.code;
    if (payload?.error?.message) message = payload.error.message;
  } catch {
    // resposta sem JSON
  }
  return { code, message };
}

function recuperavel(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

async function pool<T>(itens: T[], concorrencia: number, cancelado: () => boolean, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const trabalhadores = Array.from({ length: Math.max(1, Math.min(concorrencia, itens.length || 1)) }, async () => {
    while (cursor < itens.length && !cancelado()) {
      const atual = itens[cursor];
      cursor += 1;
      await fn(atual);
    }
  });
  await Promise.all(trabalhadores);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function ImportTab() {
  const [token, setToken] = useState(() => sessionStorage.getItem('anima-import-token') ?? '');
  const [pasta, setPasta] = useState('');
  const [encontradas, setEncontradas] = useState(0);
  const [bytesLocal, setBytesLocal] = useState(0);
  const [rodando, setRodando] = useState(false);
  const [estado, setEstado] = useState<Estado>(INICIAL);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const itensRef = useRef<Item[]>([]);
  const cancelarRef = useRef(false);
  const inicioRef = useRef(0);

  // diretriz da tag de pasta: precisa ser atributo cru (webkitdirectory)
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  }, []);

  // durante a execucao: avisa antes de fechar e evita que a tela durma
  useEffect(() => {
    if (!rodando) return undefined;
    const avisar = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    let trava: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock
      ?.request('screen')
      .then((lock) => {
        trava = lock;
      })
      .catch(() => undefined);
    return () => {
      window.removeEventListener('beforeunload', avisar);
      void trava?.release().catch(() => undefined);
    };
  }, [rodando]);

  const registrar = (texto: string, nivel: 'info' | 'erro' = 'info') => {
    const hora = new Date().toTimeString().slice(0, 8);
    const prefixo = nivel === 'erro' ? '! ' : '';
    setLinhas((atual) => [`${hora} ${prefixo}${texto}`, ...atual].slice(0, 60));
  };

  const onPasta = (event: ChangeEvent<HTMLInputElement>) => {
    const arquivos = Array.from(event.target.files ?? []);
    const raiz = arquivos[0]?.webkitRelativePath.split('/')[0] ?? '';
    const mapa = new Map<string, Partial<Item> & { uuid: string }>();

    for (const arquivo of arquivos) {
      const partes = arquivo.webkitRelativePath.split('/');
      if (partes.length !== 3) continue; // ignora soltos e subpastas (.thumbs)
      const uuid = partes[1].toLowerCase();
      if (!UUID_RE.test(uuid)) continue;
      const nome = partes[2];
      let entrada = mapa.get(uuid);
      if (!entrada) {
        entrada = { uuid };
        mapa.set(uuid, entrada);
      }
      const extensao = nome.toLowerCase().slice(nome.lastIndexOf('.'));
      if (nome === 'metadata.json' && !entrada.meta) {
        entrada.meta = arquivo;
      } else if (IMAGE_EXT.includes(extensao) && !entrada.image) {
        entrada.image = arquivo;
      }
    }

    const itens: Item[] = [];
    for (const entrada of mapa.values()) {
      if (entrada.image && entrada.meta) itens.push(entrada as Item);
    }

    itensRef.current = itens;
    setPasta(raiz);
    setEncontradas(itens.length);
    setBytesLocal(itens.reduce((soma, item) => soma + item.image.size, 0));
    setEstado(INICIAL);
    setMensagem(null);
    setErro(null);
    setLinhas([]);
    registrar(`${raiz}: ${itens.length} geracoes com imagem e metadata.`);
  };

  const validarToken = async (tokenAtual: string): Promise<number> => {
    const response = await chamada(tokenAtual, 'ping');
    if (response.status === 401 || response.status === 403) {
      const { message } = await lerErro(response);
      throw new TokenInvalido(message);
    }
    if (!response.ok) {
      const { message } = await lerErro(response);
      throw new Error(message);
    }
    const payload = (await response.json()) as { images: number; max_bytes: number };
    registrar(`Servidor com ${payload.images} imagem(ns); limite por arquivo ${formatBytes(payload.max_bytes)}.`);
    return payload.images;
  };

  const rodar = async () => {
    const tokenAtual = token.trim();
    if (!tokenAtual) {
      setErro('Cole o token de sincronizacao — ele fica em Admin > Painel > Gerar token.');
      return;
    }
    const itens = itensRef.current;
    if (itens.length === 0) {
      setErro('Escolha a pasta history antes de iniciar.');
      return;
    }

    setErro(null);
    setMensagem(null);
    setRodando(true);
    setEstado({ ...INICIAL, fase: 'hash' });
    cancelarRef.current = false;
    inicioRef.current = Date.now();

    const cache = lerCache();
    const shas = new Map<string, string>();

    try {
      await validarToken(tokenAtual);

      const paraHashear: Item[] = [];
      for (const item of itens) {
        const entrada = cache[item.uuid];
        if (entrada && entrada[0] === item.image.size && entrada[1] === item.image.lastModified && entrada[2]) {
          shas.set(item.uuid, entrada[2]);
        } else {
          paraHashear.push(item);
        }
      }

      setEstado((atual) => ({
        ...atual,
        fase: 'hash',
        hasheado: itens.length - paraHashear.length,
        hashTotal: itens.length,
      }));
      registrar(`${itens.length} gerações; ${paraHashear.length} precisam de verificacao.`);

      let desdeCache = 0;
      await pool(paraHashear, CONC_HASH, () => cancelarRef.current, async (item) => {
        if (cancelarRef.current) return;
        try {
          const buffer = await item.image.arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', buffer);
          const sha = Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
          shas.set(item.uuid, sha);
          cache[item.uuid] = [item.image.size, item.image.lastModified, sha];
          desdeCache += 1;
          if (desdeCache % 25 === 0) gravarCache(cache);
        } catch (err) {
          registrar(`Falha ao ler ${item.image.name}: ${String(err)}`, 'erro');
        }
        setEstado((atual) => ({ ...atual, hasheado: atual.hasheado + 1 }));
      });
      gravarCache(cache);

      if (cancelarRef.current) {
        setEstado((atual) => ({ ...atual, fase: 'parado' }));
        registrar('Cancelado apos a verificacao.');
        return;
      }

      // 2) o que o servidor ainda nao tem (idempotente por sha256/uuid)
      setEstado((atual) => ({ ...atual, fase: 'plan' }));
      const payload = Array.from(shas).map(([uuid, sha256]) => ({ uuid, sha256 }));
      const faltando: { uuid: string; sha256: string }[] = [];

      for (let index = 0; index < payload.length; index += LOTE) {
        if (cancelarRef.current) break;
        const lote = payload.slice(index, index + LOTE);
        const response = await chamada(
          tokenAtual,
          'plan',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: lote }) },
          60_000,
        );
        if (response.status === 401 || response.status === 403) throw new TokenInvalido('Token invalido.');
        if (!response.ok) {
          const { message } = await lerErro(response);
          throw new Error(message);
        }
        const resultado = (await response.json()) as { missing?: typeof faltando };
        faltando.push(...(resultado.missing ?? []));
        setEstado((atual) => ({ ...atual, lote: faltando.length }));
      }

      if (cancelarRef.current) {
        setEstado((atual) => ({ ...atual, fase: 'parado' }));
        registrar(`Cancelado no plano: ${faltando.length} pendente(s).`);
        return;
      }

      const porUuid = new Map(itens.map((item) => [item.uuid, item]));
      const enviar: { item: Item; sha: string }[] = [];
      for (const referencia of faltando) {
        const item = porUuid.get(referencia.uuid);
        if (item) enviar.push({ item, sha: referencia.sha256 });
      }

      const bytesTotal = enviar.reduce((soma, entrada) => soma + entrada.item.image.size, 0);
      setEstado((atual) => ({ ...atual, fase: 'upload', lote: enviar.length, bytesTotal }));
      registrar(`Servidor precisa de ${enviar.length} imagem(ns) (${formatBytes(bytesTotal)}).`);

      let existentes = 0;
      let enviados = 0;
      let falhasLocais = 0;

      if (enviar.length > 0) {
        await pool(enviar, CONC_ENVIO, () => cancelarRef.current, async (entrada) => {
          const { item, sha } = entrada;
          let ultimoErro: unknown = null;

          for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
            if (cancelarRef.current) return;
            try {
              const form = new FormData();
              form.append('uuid', item.uuid);
              form.append('sha256', sha);
              form.append('metadata', await item.meta.text());
              form.append('image', item.image, item.image.name);

              const response = await chamada(tokenAtual, 'upload', { method: 'POST', body: form }, TIMEOUT_ENVIO);
              if (response.status === 401 || response.status === 403) throw new TokenInvalido('Token invalido.');
              if (!response.ok) {
                const { code, message } = await lerErro(response);
                ultimoErro = new Error(`${code}: ${message}`);
                if (tentativa < 3 && recuperavel(response.status)) {
                  await sleep(4_000 * tentativa);
                  continue;
                }
                throw ultimoErro;
              }

              const resultado = (await response.json()) as { status?: string };
              if (resultado.status === 'already_exists') existentes += 1;
              enviados += 1;
              setEstado((atual) => ({
                ...atual,
                feito: atual.feito + 1,
                bytes: atual.bytes + item.image.size,
              }));
              return;
            } catch (err) {
              if (err instanceof TokenInvalido) throw err;
              ultimoErro = err;
              if (tentativa < 3) {
                await sleep(4_000 * tentativa);
                continue;
              }
            }
          }

          falhasLocais += 1;
          setEstado((atual) => ({ ...atual, feito: atual.feito + 1, falhas: atual.falhas + 1 }));
          registrar(`Falha ao enviar ${item.uuid}: ${ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro)}`, 'erro');
        });
      }

      setEstado((atual) => ({ ...atual, fase: cancelarRef.current ? 'parado' : 'concluido' }));
      if (cancelarRef.current) {
        registrar('Cancelado durante o envio.');
      } else {
        const depois = await validarToken(tokenAtual);
        const minutos = Math.max(1, Math.round((Date.now() - inicioRef.current) / 60_000));
        setMensagem(
          `Concluído em ${minutos} min — servidor com ${formatNumber(depois)} imagem(ns). ` +
            `Nesta rodada: ${formatNumber(enviados)} enviadas, ${formatNumber(existentes)} já existiam, ${formatNumber(falhasLocais)} falha(s).` +
            (falhasLocais > 0 ? ' Clique em continuar para tentar as falhas de novo.' : ''),
        );
        registrar('Fim da importacao.');
      }
    } catch (err) {
      if (err instanceof TokenInvalido) {
        setErro(`Token recusado: ${err.message}`);
      } else {
        setErro(err instanceof Error ? err.message : 'Falha inesperada.');
      }
      setEstado((atual) => ({ ...atual, fase: 'erro' }));
      registrar(`Interrompido: ${err instanceof Error ? err.message : String(err)}`, 'erro');
    } finally {
      gravarCache(cache);
      setRodando(false);
    }
  };

  const percentual =
    estado.fase === 'hash' && estado.hashTotal > 0
      ? Math.round((estado.hasheado / estado.hashTotal) * 100)
      : estado.fase === 'upload' && estado.lote > 0
        ? Math.round((estado.feito / estado.lote) * 100)
        : estado.fase === 'concluido'
          ? 100
          : 0;

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Importar acervo</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
            Envia a pasta <span className="text-zinc-300">history</span> pelo próprio navegador — mesma origem do
            site, sem depender de app externo. Retomável: rodar de novo envia só o que falta.
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">Token de sincronização</span>
          <input
            type="password"
            value={token}
            onChange={(event) => {
              const valor = event.target.value;
              setToken(valor);
              sessionStorage.setItem('anima-import-token', valor);
            }}
            placeholder="Admin > Painel > Gerar token"
            className="w-full"
            disabled={rodando}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={rodando}
            className="btn-ghost shrink-0"
          >
            <Icon name="upload" className="h-4 w-4" />
            Escolher pasta history
          </button>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={onPasta} />
          {pasta && (
            <span className="truncate text-[11px] text-zinc-500">
              {pasta} · {formatNumber(encontradas)} gerações · {formatBytes(bytesLocal)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Mini label="Encontradas" valor={formatNumber(encontradas)} />
          <Mini
            label="Verificadas"
            valor={estado.hashTotal > 0 ? `${formatNumber(estado.hasheado)}/${formatNumber(estado.hashTotal)}` : '—'}
          />
          <Mini label="Para enviar" valor={estado.lote > 0 ? formatNumber(estado.lote) : '—'} />
          <Mini label="Enviadas" valor={formatNumber(estado.feito)} />
          <Mini label="Falhas" valor={formatNumber(estado.falhas)} />
          <Mini label="Bytes enviados" valor={formatBytes(estado.bytes)} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span>{ROTULO[estado.fase]}</span>
            <span>{percentual}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-900">
            <div className="h-2 rounded-full bg-[#7c5cff] transition-all" style={{ width: `${percentual}%` }} />
          </div>
        </div>

        {mensagem && (
          <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-200">{mensagem}</p>
        )}
        {erro && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{erro}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void rodar()}
            disabled={rodando || encontradas === 0}
            className="btn-primary flex-1"
          >
            {rodando ? 'Importando...' : estado.fase === 'ocioso' ? 'Iniciar importação' : 'Continuar importação'}
          </button>
          <button
            type="button"
            onClick={() => {
              cancelarRef.current = true;
            }}
            disabled={!rodando}
            className="btn-ghost"
          >
            Parar
          </button>
        </div>

        <ol className="space-y-1 text-[11px] leading-relaxed text-zinc-500">
          <li>1. Abra Admin Painel, gere um token de sincronização e cole acima.</li>
          <li>
            2. Escolha a pasta <span className="text-zinc-300">history</span> (ex.: E:\Anima2000\anima-electron\history).
          </li>
          <li>3. Mantenha esta aba aberta e o PC acordado até terminar.</li>
          <li>4. Se interromper, clique em continuar: o servidor deduplica por SHA-256/uuid.</li>
        </ol>
      </section>

      {linhas.length > 0 && (
        <section className="card p-4">
          <h3 className="text-[11px] uppercase tracking-wide text-zinc-500">Log</h3>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-zinc-400">
            {linhas.join('\n')}
          </pre>
        </section>
      )}
    </div>
  );
}

function Mini({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="truncate text-sm font-semibold text-zinc-100">{valor}</div>
    </div>
  );
}