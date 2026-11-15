import { useEffect, useRef } from 'react';
import { drawCharacter } from '../game/draw';

/** Small canvas that runs a draw callback; used for icons and character portraits. */
export function Icon({ w, h, draw, deps = [] }: { w: number; h: number; draw: (c: CanvasRenderingContext2D) => void; deps?: unknown[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, (w / 2) * dpr, (h / 2) * dpr);
    c.clearRect(-w, -h, w * 2, h * 2);
    draw(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, ...deps]);
  return <canvas ref={ref} style={{ width: w, height: h }} />;
}

export function CharPortrait({ char, color, size, animate = false }: { char: string; color: string; size: number; animate?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = cv.height = size * dpr;
    const c = cv.getContext('2d')!;
    let raf = 0;
    const paint = (t: number) => {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, size, size);
      c.translate(size / 2, size / 2 + (animate ? Math.sin(t / 300) * size * 0.02 : 0));
      const s = size / 62;
      c.scale(s, s);
      c.rotate(Math.PI / 2);
      drawCharacter(c, char, color, { walk: animate ? t / 130 : 0, weapon: null, recoil: 0, hurt: 0, downed: false, punch: 0 });
      if (animate) raf = requestAnimationFrame(paint);
    };
    paint(0);
    return () => cancelAnimationFrame(raf);
  }, [char, color, size, animate]);
  return <canvas ref={ref} style={{ width: size, height: size }} />;
}
