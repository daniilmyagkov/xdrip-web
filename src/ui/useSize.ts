/** Size of an element in CSS pixels, kept up to date (so drawings are never stretched). */
import { useEffect, useRef, useState } from 'preact/hooks';

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((items) => {
      const r = items[0]?.contentRect;
      if (r) setSize((old) => (old.w === Math.round(r.width) && old.h === Math.round(r.height) ? old : { w: Math.round(r.width), h: Math.round(r.height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
