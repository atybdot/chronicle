# Chronicle

[![npm version](https://img.shields.io/npm/v/@atybdot/chronicle)](https://www.npmjs.com/package/@atybdot/chronicle)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.sh)

Intelligently backfill git commit history by analyzing uncommitted changes and splitting them into atomic, well-organized commits with realistic timestamps.

## Overview

Chronicle is a monorepo containing:

- **[CLI](./apps/cli)** - AI-powered command-line tool to generate realistic git commit history
- **[Web](./apps/web)** - Website and documentation at [chronicle.atyb.me](https://chronicle.atyb.me)

## Quick Start

```bash
# Install Bun, then Chronicle
curl -fsSL https://bun.sh/install | bash
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
bun add -g @atybdot/chronicle

# Or run it without a global install
bunx @atybdot/chronicle
```

```bash
# Interactive setup
chronicle config init

# Analyze changes
chronicle analyze

# Backfill commit history
chronicle backfill --date-range "last 2 weeks" --no-dry-run
```

## Project Structure

```
chronicle/
├── apps/
│   ├── cli/          # Chronicle CLI (@atybdot/chronicle)
│   └── web/          # Website (Astro)
├── packages/         # Shared packages (if any)
└── turbo.json        # Turborepo configuration
```

## Development

```bash
# Install dependencies
bun install

# Run all apps in development
bun run dev

# Build all apps
bun run build

# Run tests
bun run test

# Type check
bun run typecheck
```

## Resources

- **Website**: [chronicle.atyb.me](https://chronicle.atyb.me)
- **CLI Documentation**: [apps/cli/README.md](apps/cli/README.md)
- **Issues**: [github.com/atybdot/chronicle/issues](https://github.com/atybdot/chronicle/issues)

## License

MIT
