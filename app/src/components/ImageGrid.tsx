import { Link } from 'react-router-dom';
import type { ImageItem } from '../lib/types';
import { Icon } from './Icon';

interface Props {
  items: ImageItem[];
  query: string;
  blurred: boolean;
  onReveal: () => void;
}

export default function ImageGrid({ items, query, blurred, onReveal }: Props) {
  const suffix = query ? `?s=${encodeURIComponent(query)}` : '';

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.uuid} className="relative">
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
                }`}
              />
            </div>
          </Link>

          {item.favorite && (
            <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-black/55 p-1.5">
              <Icon name="heart" filled className="h-3 w-3 text-accent-soft" />
            </span>
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
        </div>
      ))}
    </div>
  );
}
