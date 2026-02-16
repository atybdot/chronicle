# Chronicle Website

Official documentation website for Chronicle CLI, built with [Astro](https://astro.build) and deployed on [Cloudflare Pages](https://pages.cloudflare.com).

## Overview

This is the public-facing website for Chronicle CLI tool. It includes:

- **Landing Page** - Features, quick start guide, and usage examples
- **Commands Reference** - Complete CLI command documentation
- **Configuration Guide** - Settings and environment variables
- **Telemetry Dashboard** - Anonymous usage statistics (opt-in)

## Tech Stack

- **Framework**: [Astro](https://astro.build) 6.0 (beta)
- **UI**: React 19 + Tailwind CSS 4
- **Components**: shadcn/ui patterns
- **Database**: Cloudflare D1 (telemetry)
- **Deployment**: Cloudflare Pages + Workers

## Project Structure

```
src/
├── components/          # Astro and React components
│   ├── react/          # React components
│   └── ui/             # Reusable UI components
├── pages/              # Astro pages (routes)
│   ├── index.astro     # Landing page
│   ├── commands.astro # CLI commands reference
│   ├── configuration.astro
│   └── telemetry.astro
├── layouts/            # Page layouts
├── backend/            # API routes (Cloudflare Workers)
│   ├── routes/        # API endpoints
│   └── db/           # D1 database schema
└── styles/            # Global CSS
```

## Commands

| Command | Action |
|---------|--------|
| `bun dev` | Start local dev server |
| `bun build` | Build for production |
| `bun preview` | Preview production build locally |
| `bun deploy` | Deploy to Cloudflare Pages |

### Database Commands

| Command | Action |
|---------|--------|
| `bun db:migrate` | Run D1 migrations (remote) |
| `bun db:migrate:local` | Run D1 migrations (local) |
| `bun db:generate` | Generate Drizzle schema |
| `bun db:seed` | Seed local database with demo data |
| `bun db:seed:remote` | Seed remote database with demo data |

## Development

```bash
# Install dependencies
bun install

# Start development server
bun dev

# Build for production
bun build

# Preview production build
bun preview
```

## Deployment

The site automatically deploys to Cloudflare Pages via GitHub Actions on push to main.

```bash
# Manual deployment
bun run deploy
```

## License

MIT
