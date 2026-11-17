import { Link } from 'react-router-dom';
import { useRef } from 'react';
import type { ImageItem } from '../lib/types';
import { Icon } from './Icon';

interface Props {
  items: ImageItem[];
  query: string;
  blurred: boolean;
  onReveal: () => void;
  selectedUuid?: string | null;
  onDelete?: (uuid: string) => void;
}

export default function ImageGrid({ items, query, blurred, onReveal, selectedUuid, onDelete }: Props) {
  const suffix = query ? `?s=${encodeURIComponent(query)}` : '';
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleDelete = (uuid: string, event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (!window.confirm('Mover esta imagem para a lixeira?')) return;
    void onDelete?.(uuid);
  };

  const scrollTo = (uuid: string) => {
    const el = itemRefs.current.get(uuid);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  };

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((item) => {
        const isSelected = item.uuid === selectedUuid;
        return (
          <div key={item.uuid} className="relative" data-uuid={item.uuid} ref={(el) => el && itemRefs.current.set(item.uuid, el)}>
            <Link
              to={`/i/${item.uuid}${suffix}`}
              className="block overflow-hidden rounded-xl bg-ink-800"
              aria-label="Abrir imagem"
            >
              <div className="aspect-[3/4] w-full">
                <img
                  src={item.thumb}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width={item.width}
                  height={item.height}
                  className={`h-full w-full object-cover transition duration-300 ${
                    blurred ? 'scale-110 blur-2xl' : 'blur-0'
                  } ${isSelected ? 'ring-2 ring-accent' : ''}`}
                />
              </div>
            </Link>

            {item.favorite && (
              <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-black/55 p-1.5">
                <Icon name="heart" filled className="h-3 w-3 text-accent-soft" />
              </span>
            )}

            {onDelete && (
              <button
                type="button"
                onClick={(event) => handleDelete(item.uuid, event)}
                className="absolute right-1 bottom-1 rounded-full bg-black/60 p-1.5 text-white/90 hover:bg-black/80 backdrop-blur-sm"
                aria-label="Excluir imagem"
              >
                <Icon name="trash" className="h-3.5 w-3.5" />
              </button>
            )}

            {blurred && (
              <button
                type="button"
                onClick={onReveal}
                className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/20 text-[11px] font-medium text-white/90"
              >
                <span className="rounded-full bg-black/60 px-2.5 py-1">mostrar</span>
              </button>
            )}

            {isSelected && (
              <span className="pointer-events-none absolute left-1 top-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">
                selecionada
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
