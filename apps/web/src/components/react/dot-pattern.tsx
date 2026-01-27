"use client";

import { useEffect, useRef, useState } from "react";

interface DotPatternProps {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
  cr?: number;
  className?: string;
  glow?: boolean;
}

function parseOklchToRgb(oklch: string): { r: number; g: number; b: number } | null {
  const match = oklch.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!match) return null;

  const l = parseFloat(match[1]);
  const c = parseFloat(match[2]);
  const h = parseFloat(match[3]) * (Math.PI / 180);

  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const y = l + 0.813 * b;
  const x = l + 0.413 * a - 0.165 * b;
  const z = l - 0.563 * a + 0.0127 * b;

  const r = Math.max(0, Math.min(1, x * 3.2406 + y * -1.5372 + z * -0.4986)) * 255;
  const g = Math.max(0, Math.min(1, x * -0.9689 + y * 1.8758 + z * 0.0415)) * 255;
  const b_ = Math.max(0, Math.min(1, x * 0.0557 + y * -0.204 + z * 1.057)) * 255;

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b_) };
}

export default function DotPattern({
  width: widthProp = 16,
  height: heightProp = 16,
  x: _x = 0,
  y: _y = 0,
  cx = 1,
  cy = 1,
  cr: crProp = 1,
  className = "",
  glow = false,
}: DotPatternProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(window.matchMedia("(max-width: 640px)").matches);
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  const width = isMobile ? widthProp : widthProp;
  const height = isMobile ? heightProp : heightProp;
  const cr = isMobile ? Math.max(0.5, crProp * 0.8) : crProp;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let animationId: number;
    let dots: Array<{ x: number; y: number; delay: number; duration: number; phase: number }> = [];

    const render = () => {
      const { width: containerWidth, height: containerHeight } = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = containerWidth * dpr;
      canvas.height = containerHeight * dpr;
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${containerHeight}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.imageSmoothingEnabled = false;
      ctx.scale(dpr, dpr);

      const cols = Math.ceil(containerWidth / width);
      const rows = Math.ceil(containerHeight / height);

      const mutedFg =
        getComputedStyle(container).getPropertyValue("--muted-foreground").trim() ||
        getComputedStyle(document.documentElement).getPropertyValue("--muted-foreground").trim();
      const rgb = parseOklchToRgb(mutedFg) || { r: 115, g: 115, b: 115 };

      if (dots.length !== cols * rows) {
        dots = [];
        for (let i = 0; i < cols * rows; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols);
          dots.push({
            x: Math.floor(col * width + cx),
            y: Math.floor(row * height + cy),
            delay: Math.random() * 5,
            duration: Math.random() * 3 + 2,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }

      const time = performance.now() / 1000;

      ctx.clearRect(0, 0, containerWidth, containerHeight);

      if (glow) {
        dots.forEach((dot) => {
          const t = (time + dot.phase) % dot.duration;
          const progress = t / dot.duration;
          const scale = 0.5 + Math.sin(progress * Math.PI * 2) * 0.5;
          const opacity = 0.2 + (0.5 + Math.sin(progress * Math.PI * 2) * 0.5) * 0.4;

          const gradient = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, cr * scale * 3);
          gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`);
          gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, cr * scale * 3, 0, Math.PI * 2);
          ctx.fill();
        });
      } else {
        ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        dots.forEach((dot) => {
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, cr, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [width, height, cx, cy, cr, glow, isMobile]);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}