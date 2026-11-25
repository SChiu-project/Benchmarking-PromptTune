"use client";

import { useEffect, useRef } from "react";
import {
  defaultPalette,
  paintField,
  type PaintMode,
  type PaintPalette,
} from "@/lib/painter";

// Painted fields are deterministic, so a route revisited at the same size
// reuses its bitmap instead of repainting thousands of strokes.
const cache = new Map<string, HTMLCanvasElement>();
const CACHE_LIMIT = 12;

function palette(): PaintPalette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    d1: read("--d1", defaultPalette.d1),
    d2: read("--d2", defaultPalette.d2),
    d3: read("--d3", defaultPalette.d3),
    d4: read("--d4", defaultPalette.d4),
  };
}

function render(canvas: HTMLCanvasElement, mode: PaintMode, seed: number) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  if (!width || !height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const key = `${mode}:${seed}:${width}x${height}@${dpr}`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  let source = cache.get(key);
  if (!source) {
    source = document.createElement("canvas");
    source.width = canvas.width;
    source.height = canvas.height;
    const off = source.getContext("2d");
    if (!off) return;
    off.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintField(off, width, height, mode, seed, palette());
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, source);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
}

/** A decorative, seeded brushwork field. Hidden from assistive technology. */
export function PaintedField({
  mode,
  seed,
  className,
}: {
  mode: PaintMode;
  seed: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    render(canvas, mode, seed);
    if (typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = `${canvas.clientWidth}x${canvas.clientHeight}`;
    const observer = new ResizeObserver(() => {
      const size = `${canvas.clientWidth}x${canvas.clientHeight}`;
      if (size === last) return;
      last = size;
      clearTimeout(timer);
      timer = setTimeout(() => render(canvas, mode, seed), 120);
    });
    observer.observe(canvas);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [mode, seed]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
