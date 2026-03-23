// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from "@tailwindcss/vite";
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://chronicle.atyb.me',
  output: 'server',
  adapter: vercel({
    isr: {
      expiration: 60 * 30,
    },
  }),
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
    },
  },
  experimental: {
    fonts: [{ provider: fontProviders.google(), cssVariable: "--font-geist-mono", name: "Geist Mono" }],
  },
  integrations: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
    sitemap(),
  ],
});
