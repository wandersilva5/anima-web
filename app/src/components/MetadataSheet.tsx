import { useState } from 'react';
import { copyText, formatBytes, formatDateTime } from '../lib/format';
import type { ImageDetail } from '../lib/types';
import { Icon } from './Icon';

const CATEGORY_LABELS: Record<string, string> = {
  cabelo: 'Cabelo',
  olhos: 'Olhos',
  rosto: 'Rosto',
  expressao: 'Expressão',
  pose: 'Pose',
  corpo: 'Corpo',
  roupa: 'Roupa',
  acessorios: 'Acessórios',
  cenario: 'Cenário',
  iluminacao: 'Iluminação',
  estilo: 'Estilo',
  hora: 'Hora do dia',
  outros: 'Outros',
};

interface Props {
  detail: ImageDetail;
  onClose: () => void;
  onTagClick?: (tagId: number) => void;
}

export default function MetadataSheet({ detail, onClose, onTagClick }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (label: string, text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1600);
    }
  };

  const allPrompt = [
    detail.prompt ?? '',
    detail.negative_prompt ? `\n\nNegative prompt: ${detail.negative_prompt}` : '',
  ].join('');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60" onClick={onClose}>
      <div
        className="mt-auto flex max-h-[88vh] animate-slide-up flex-col rounded-t-3xl border-t border-ink-700 bg-ink-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Metadados</h2>
            <p className="truncate text-[11px] text-zinc-500">
              {detail.model ?? 'modelo desconhecido'} · {formatDateTime(detail.ts)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-ink-800 p-2" aria-label="Fechar metadados">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="card px-3 py-2">
              <div className="text-zinc-500">Seed</div>
              <div className="font-mono text-zinc-100">{detail.seed ?? '—'}</div>
            </div>
            <div className="card px-3 py-2">
              <div className="text-zinc-500">Passos / CFG</div>
              <div className="font-mono text-zinc-100">
                {detail.steps ?? '—'} / {detail.cfg ?? '—'}
              </div>
            </div>
            <div className="card px-3 py-2">
              <div className="text-zinc-500">Resolução</div>
              <div className="font-mono text-zinc-100">
                {detail.width}×{detail.height}
              </div>
            </div>
            <div className="card px-3 py-2">
              <div className="text-zinc-500">Tamanho</div>
              <div className="font-mono text-zinc-100">{formatBytes(detail.bytes)}</div>
            </div>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Prompt positivo</h3>
              <button
                type="button"
                onClick={() => handleCopy('prompt', detail.prompt ?? '')}
                className="flex items-center gap-1 text-[11px] text-accent-soft"
              >
                <Icon name={copied === 'prompt' ? 'check' : 'copy'} className="h-3.5 w-3.5" />
                {copied === 'prompt' ? 'copiado' : 'copiar'}
              </button>
            </div>
            <p className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-ink-800 p-3 text-[12px] leading-relaxed text-zinc-300">
              {detail.prompt || '—'}
            </p>
          </section>

          <details className="rounded-xl bg-ink-800 p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Prompt negativo
            </summary>
            <p className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-zinc-400">
              {detail.negative_prompt || '—'}
            </p>
            {detail.negative_prompt && (
              <button
                type="button"
                onClick={() => handleCopy('negative', detail.negative_prompt ?? '')}
                className="mt-2 flex items-center gap-1 text-[11px] text-accent-soft"
              >
                <Icon name={copied === 'negative' ? 'check' : 'copy'} className="h-3.5 w-3.5" />
                {copied === 'negative' ? 'copiado' : 'copiar negativo'}
              </button>
            )}
          </details>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              LoRAs ({detail.loras.length})
            </h3>
            {detail.loras.length === 0 && <p className="text-[12px] text-zinc-500">Nenhuma LoRA usada.</p>}
            <ul className="space-y-1.5">
              {detail.loras.map((lora) => (
                <li key={lora.name} className="flex items-center justify-between gap-2 rounded-lg bg-ink-800 px-3 py-2">
                  <span className="min-w-0 truncate text-[12px] text-zinc-200" title={lora.name}>
                    {lora.short}
                  </span>
                  <span className="shrink-0 rounded-md bg-ink-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {lora.model_strength ?? '—'} / {lora.clip_strength ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Tags</h3>
            {Object.keys(detail.tags_by_category).length === 0 && (
              <p className="text-[12px] text-zinc-500">Nenhuma tag reconhecida neste prompt.</p>
            )}
            {Object.entries(detail.tags_by_category).map(([category, tags]) => (
              <div key={category} className="space-y-1.5">
                <h4 className="text-[10px] uppercase tracking-wide text-zinc-500">
                  {CATEGORY_LABELS[category] ?? category}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => onTagClick?.(tag.id)}
                      className={`chip !py-1 !text-[11px] ${tag.curated ? '' : 'opacity-70'}`}
                    >
                      {tag.pt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-1 border-t border-ink-800 pt-3 text-[11px] text-zinc-500">
            <p className="break-all">
              <span className="text-zinc-400">Arquivo:</span> {detail.filename}
            </p>
            <p className="break-all">
              <span className="text-zinc-400">SHA-256:</span> {detail.sha256.slice(0, 32)}…
            </p>
          </section>
        </div>

        <div className="safe-bottom flex gap-2 border-t border-ink-800 px-4 py-3">
          <a href={detail.urls.orig} download={detail.filename} className="btn-ghost flex-1">
            <Icon name="download" className="h-4 w-4" />
            Original
          </a>
          <button type="button" onClick={() => handleCopy('tudo', allPrompt)} className="btn-primary flex-1">
            <Icon name={copied === 'tudo' ? 'check' : 'copy'} className="h-4 w-4" />
            {copied === 'tudo' ? 'Copiado' : 'Copiar tudo'}
          </button>
        </div>
      </div>
    </div>
  );
}
