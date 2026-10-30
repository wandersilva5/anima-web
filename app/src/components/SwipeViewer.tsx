import { useEffect, useRef, useState } from 'react';

interface Props {
  src: string;
  alt?: string;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onTap?: () => void;
}

interface Point {
  x: number;
  y: number;
}

export default function SwipeViewer({ src, alt, onPrev, onNext, onClose, onTap }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const transform = useRef({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef({
    mode: 'idle' as 'idle' | 'drag' | 'pan' | 'pinch',
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
    startScale: 1,
    pinchDist: 0,
    midX: 0,
    midY: 0,
    moved: false,
    lastTap: 0,
    lastTapX: 0,
    lastTapY: 0,
  });

  const zoomedRef = useRef(false);
  const [zoomed, setZoomed] = useState(false);

  const apply = (animate = false) => {
    const el = imgRef.current;
    if (!el) return;
    const t = transform.current;
    el.style.transition = animate ? 'transform 180ms cubic-bezier(.2,.8,.2,1)' : 'none';
    el.style.transform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale})`;
    const isZoomed = t.scale > 1.02;
    if (isZoomed !== zoomedRef.current) {
      zoomedRef.current = isZoomed;
      setZoomed(isZoomed);
    }
  };

  const clampPan = () => {
    const el = imgRef.current;
    const t = transform.current;
    if (!el || t.scale <= 1.02) {
      t.x = 0;
      t.y = 0;
      return;
    }
    const maxX = (el.clientWidth * (t.scale - 1)) / 2;
    const maxY = (el.clientHeight * (t.scale - 1)) / 2;
    t.x = Math.max(-maxX, Math.min(maxX, t.x));
    t.y = Math.max(-maxY, Math.min(maxY, t.y));
  };

  const reset = (animate = false) => {
    transform.current = { scale: 1, x: 0, y: 0 };
    apply(animate);
  };

  useEffect(() => {
    reset(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stageRef.current?.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const g = gesture.current;
    const t = transform.current;
    g.moved = false;

    if (pointers.current.size === 1) {
      g.mode = t.scale > 1.02 ? 'pan' : 'drag';
      g.startX = event.clientX;
      g.startY = event.clientY;
      g.baseX = t.x;
      g.baseY = t.y;
      g.startScale = t.scale;
      if (imgRef.current) imgRef.current.style.transition = 'none';
    } else if (pointers.current.size === 2) {
      const points = Array.from(pointers.current.values());
      g.mode = 'pinch';
      g.pinchDist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
      g.startScale = t.scale;
      g.baseX = t.x;
      g.baseY = t.y;
      g.midX = (points[0].x + points[1].x) / 2;
      g.midY = (points[0].y + points[1].y) / 2;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = pointers.current.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;

    const g = gesture.current;
    const t = transform.current;

    if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > 8) {
      g.moved = true;
    }

    if (g.mode === 'drag') {
      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;
      const vertical = Math.abs(dy) > Math.abs(dx);
      t.x = dx;
      t.y = vertical ? dy * 0.35 : 0;
      apply(false);
      return;
    }

    if (g.mode === 'pan') {
      t.x = g.baseX + (event.clientX - g.startX);
      t.y = g.baseY + (event.clientY - g.startY);
      clampPan();
      apply(false);
      return;
    }

    if (g.mode === 'pinch' && pointers.current.size >= 2) {
      const points = Array.from(pointers.current.values());
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
      const midX = (points[0].x + points[1].x) / 2;
      const midY = (points[0].y + points[1].y) / 2;
      const nextScale = Math.min(4, Math.max(1, g.startScale * (distance / g.pinchDist)));
      t.scale = nextScale;
      t.x = g.baseX + (midX - g.midX);
      t.y = g.baseY + (midY - g.midY);
      clampPan();
      apply(false);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    const t = transform.current;

    if (g.mode === 'pinch') {
      if (t.scale < 1.05) {
        reset(true);
      } else {
        clampPan();
        apply(true);
      }
      if (pointers.current.size === 1) {
        const point = Array.from(pointers.current.values())[0];
        g.mode = 'pan';
        g.startX = point.x;
        g.startY = point.y;
        g.baseX = t.x;
        g.baseY = t.y;
      } else {
        g.mode = 'idle';
      }
      return;
    }

    if (g.mode === 'drag') {
      const now = Date.now();

      if (!g.moved) {
        const isDoubleTap = now - g.lastTap < 300 && Math.hypot(event.clientX - g.lastTapX, event.clientY - g.lastTapY) < 26;
        if (isDoubleTap) {
          g.lastTap = 0;
          if (t.scale > 1.02) {
            reset(true);
          } else {
            const rect = stageRef.current?.getBoundingClientRect();
            t.scale = 2.5;
            if (rect) {
              const cx = event.clientX - (rect.left + rect.width / 2);
              const cy = event.clientY - (rect.top + rect.height / 2);
              t.x = -cx * 1.5;
              t.y = -cy * 1.5;
              clampPan();
            }
            apply(true);
          }
          g.mode = 'idle';
          return;
        }
        g.lastTap = now;
        g.lastTapX = event.clientX;
        g.lastTapY = event.clientY;
        onTap?.();
        g.mode = 'idle';
        return;
      }

      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;

      if (Math.abs(dx) > 76 && Math.abs(dx) > Math.abs(dy)) {
        const width = stageRef.current?.clientWidth ?? 360;
        t.x = dx > 0 ? width : -width;
        t.y = 0;
        apply(true);
        const go = dx > 0 ? onPrev : onNext;
        window.setTimeout(() => {
          if (go) {
            go();
          } else {
            reset(true);
          }
        }, 165);
        g.mode = 'idle';
        return;
      }

      if (dy > 110 && Math.abs(dy) > Math.abs(dx)) {
        t.y = stageRef.current?.clientHeight ?? 520;
        apply(true);
        window.setTimeout(onClose, 165);
        g.mode = 'idle';
        return;
      }

      reset(true);
      g.mode = 'idle';
      return;
    }

    if (g.mode === 'pan') {
      clampPan();
      apply(true);
      g.mode = 'idle';
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const t = transform.current;
    const next = Math.min(4, Math.max(1, t.scale * (event.deltaY < 0 ? 1.12 : 0.9)));
    if (next <= 1.02) {
      reset(true);
      return;
    }
    t.scale = next;
    clampPan();
    apply(true);
  };

  return (
    <div
      ref={stageRef}
      className="absolute inset-0 overflow-hidden"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      <div className="flex h-full w-full items-center justify-center">
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? 'Imagem gerada'}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{ willChange: 'transform', transformOrigin: 'center center' }}
        />
      </div>

      {zoomed && (
        <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-1 text-[10px] text-white/80">
          2 dedos para mover · 2 toques para voltar
        </span>
      )}
    </div>
  );
}
