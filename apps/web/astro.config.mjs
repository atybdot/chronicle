// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
// Astro 6: output: "static" is default, pages with `export const prerender = false` are SSR
export default defineConfig({
  site: 'https://chronicle.atyb.me',
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
    imageService: 'passthrough',
  }),
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
    },
    ssr: {
      external: ['sharp', 'detect-libc', 'node:util', 'node:stream', 'node:events', 'node:os', 'node:path', 'node:child_process', 'node:crypto', 'child_process', 'fs'],
    },
    build: {
      rollupOptions: {
        external: ['sharp', 'detect-libc'],
      },
    },
  },
  fonts: [{ provider: fontProviders.google(), "cssVariable": "--font-geist-mono", name: "Geist Mono" }],
  integrations: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
    sitemap(),
  ],
});
