"use client";

import { useEffect, useRef, useState } from "react";

interface GradientOrbProps {
  /** Size of the orb on mobile (default: 400) */
  mobileSize?: number;
  /** Size of the orb on sm+ breakpoint (default: 900) */
  desktopSize?: number;
  /** Animation duration in seconds (default: 8) */
  duration?: number;
  /** Base opacity on mobile (default: 0.3) */
  mobileOpacity?: number;
  /** Base opacity on sm+ breakpoint (default: 0.1) */
  desktopOpacity?: number;
  className?: string;
}

/**
 * Animated gradient orb that oscillates between sky-500 and lime-500 hues.
 * The center is positioned at the top-left corner (0, 0).
 * 
 * Responsive behavior:
 * - Mobile (<640px): 400px size, 0.3 opacity
 * - Desktop (>=640px / sm): 900px size, 0.1 opacity
 * 
 * Tailwind color reference:
 * - sky-500: hsl(199, 89%, 48%) → ~199°
 * - lime-500: hsl(84, 81%, 44%) → ~84°
 */
export default function GradientOrb({
  mobileSize = 400,
  desktopSize = 900,
  duration = 8,
  mobileOpacity = 0.3,
  desktopOpacity = 0.1,
  className = "",
}: GradientOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const [isDesktop, setIsDesktop] = useState(false);

  // Tailwind sm breakpoint is 640px
  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 640px)");
    setIsDesktop(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  const size = isDesktop ? desktopSize : mobileSize;
  const opacity = isDesktop ? desktopOpacity : mobileOpacity;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    // Hue range: sky-500 (~199°) to lime-500 (~84°)
    // We'll oscillate through this range for a smooth color transition
    const HUE_SKY = 199;
    const HUE_LIME = 84;
    const HUE_RANGE = HUE_SKY - HUE_LIME; // 115° range

    const render = (time: number) => {
      const t = time / 1000;
      
      // Oscillate between 0 and 1 using sine wave
      const oscillation = (Math.sin((t / duration) * Math.PI * 2) + 1) / 2;
      
      // Calculate current base hue (oscillating between lime and sky)
      const baseHue = HUE_LIME + oscillation * HUE_RANGE;
      
      // Create complementary color (180° offset, but we'll use a smaller offset for harmony)
      const complementHue = (baseHue + 60) % 360; // Analogous harmony
      
      ctx.clearRect(0, 0, size, size);

      // Create a multi-stop radial gradient from center (0,0) outward
      // The gradient extends from the corner to create the orb effect
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size);

      // Inner core - bright, saturated
      gradient.addColorStop(0, `hsla(${baseHue}, 85%, 55%, ${opacity * 1.2})`);
      
      // Transition zone - blend to complement
      gradient.addColorStop(0.25, `hsla(${(baseHue + complementHue) / 2}, 75%, 50%, ${opacity})`);
      
      // Mid zone - complement color
      gradient.addColorStop(0.5, `hsla(${complementHue}, 70%, 45%, ${opacity * 0.8})`);
      
      // Outer fade - softer version
      gradient.addColorStop(0.75, `hsla(${complementHue}, 60%, 40%, ${opacity * 0.4})`);
      
      // Edge - fade to transparent
      gradient.addColorStop(1, `hsla(${complementHue}, 50%, 35%, 0)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      // Add a secondary layer for more depth and color variance
      const gradient2 = ctx.createRadialGradient(0, 0, size * 0.1, 0, 0, size * 0.7);
      
      // Secondary oscillation with phase offset for more dynamic feel
      const secondaryOscillation = (Math.sin((t / duration) * Math.PI * 2 + Math.PI / 3) + 1) / 2;
      const secondaryHue = HUE_LIME + secondaryOscillation * HUE_RANGE;
      
      gradient2.addColorStop(0, `hsla(${secondaryHue}, 90%, 60%, ${opacity * 0.5})`);
      gradient2.addColorStop(0.4, `hsla(${(secondaryHue + 30) % 360}, 80%, 50%, ${opacity * 0.3})`);
      gradient2.addColorStop(1, `hsla(${(secondaryHue + 45) % 360}, 70%, 45%, 0)`);

      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = gradient2;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = "source-over";

      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [size, duration, opacity]);

  return (
    <div
      className={`pointer-events-none fixed top-0 right-0 -z-1 rotate-90 ${className}`}
      style={{
        width: size,
        height: size,
        filter: "blur(80px)",
      }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
      />
    </div>
  );
}
