# Chronicle CLI

[![npm version](https://img.shields.io/npm/v/@atybdot/chronicle)](https://www.npmjs.com/package/@atybdot/chronicle)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI-powered CLI that transforms uncommitted changes into a realistic git commit history.

## Features

- **AI-Powered Analysis**: Uses LLM to analyze your codebase and intelligently split changes into logical, atomic commits
- **Smart Commit Ordering**: AI determines the optimal commit order based on file dependencies
- **Realistic Distribution**: Spreads commits across a date range with realistic work patterns (weekday bias, work hours, session clustering)
- **Natural Language Dates**: Specify date ranges naturally like "last 30 days" or "spread over 2 weeks"
- **Visual Previews**: ASCII commit graph and GitHub contribution graph preview
- **Multi-Provider Support**: Works with OpenAI, Anthropic Claude, Google Gemini, OpenRouter, or local Ollama models
- **Dry-Run Mode**: Preview the commit plan before executing

## Installation

```bash
# Install globally with Bun
bun add -g @atybdot/chronicle

# Or run directly with bunx
bunx chronicle
```

## Quick Start

1. **Configure your LLM provider** (interactive setup):
```bash
chronicle config init
```

**Or configure manually**:
```bash
# Set your API key (works with any provider)
export CHRONICLE_AI_KEY=your-api-key

# Optionally set a different provider (default is openai)
chronicle config set llm.provider anthropic  # or gemini, openrouter, ollama
```

2. **Analyze your changes**:
```bash
chronicle analyze
```

3. **Backfill your commit history**:
```bash
# Dry run (preview only)
chronicle backfill --date-range "last 2 weeks"

# Execute for real
chronicle backfill --date-range "last 2 weeks" --no-dry-run
```

## Commands

### `chronicle analyze`

Analyze uncommitted changes and see how they would be split into commits.

```bash
chronicle analyze [options]

Options:
  --path <path>           Path to git repository (default: current directory)
  --include-staged        Include staged changes (default: true)
  --include-unstaged      Include unstaged changes (default: true)
  --include-untracked     Include untracked files (default: true)
```

### `chronicle backfill`

Generate and execute a commit plan.

```bash
chronicle backfill [options]

Options:
  --path <path>           Path to git repository
  --date-range <range>    Natural language date range (e.g., "last 30 days")
  --start-date <date>     Explicit start date (ISO format)
  --end-date <date>       Explicit end date (ISO format)
  --dry-run               Preview without making changes (default: true)
  --no-dry-run            Execute the commit plan
  --interactive           Interactive mode with prompts (default: true)
  --output <format>       Output format: visual, json, minimal (default: visual)
```

### `chronicle status`

Show the current status of uncommitted changes.

```bash
chronicle status [--path <path>]
```

### `chronicle config`

Manage configuration.

```bash
# Interactive setup wizard (recommended for first-time setup)
chronicle config init

# Show current config
chronicle config show

# Get a value
chronicle config get llm.provider

# Set a value
chronicle config set llm.apiKey sk-xxx
chronicle config set defaults.workHoursStart 10
chronicle config set defaults.excludeWeekends true
```

#### `chronicle config init`

The interactive setup wizard guides you through:
1. **Provider selection** - Choose from OpenAI, Anthropic, Google Gemini, OpenRouter, or Ollama
2. **Model selection** - Pick from recommended models or enter a custom model name
3. **API key configuration** - Three options:
   - Use environment variable (recommended for security)
   - Store in config file (convenient but less secure)
   - Skip and configure later

Your API key is stored locally only and is never sent to any remote server except the LLM provider you choose.

## Configuration

Configuration is stored in `~/.config/chronicle/config.json`.

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o",
    "apiKey": "sk-xxx",
    "baseUrl": null
  },
  "git": {
    "authorName": null,
    "authorEmail": null
  },
  "defaults": {
    "distribution": "realistic",
    "dryRun": true,
    "workHoursStart": 9,
    "workHoursEnd": 18,
    "excludeWeekends": false
  }
}
```

## Environment Variables

Set your API key via environment variable (recommended):
```bash
export CHRONICLE_AI_KEY=your-api-key
```

This single environment variable works with all providers (OpenAI, Anthropic, Gemini, OpenRouter). Ollama runs locally and doesn't require an API key.

## Example Output

```
📋 Commit Plan Summary

  Total commits: 8
  Total files: 15
  Date range: 1/10/2024 - 1/20/2024
  Days: 10
  Avg commits/day: 0.8
  Strategy: realistic

  By category:
    🎉 setup: 1
    ✨ feature: 4
    🐛 fix: 2
    📚 docs: 1

📊 Commit Graph Preview

Mon Jan 15
  ├─ 09:23 AM 🎉 chore: initial project setup
  └─ 10:45 AM ✨ feat: add user authentication

Tue Jan 16
  └─ 02:30 PM ✨ feat: implement dashboard

📅 GitHub Contribution Preview

      Sun Mon Tue Wed Thu Fri Sat
Jan 14   ░   ▒   ░   ░   ░   ░   ░
Jan 21   ░   ░   ▓   ░   █   ░   ░
```

## Development

```bash
# Install dependencies
bun install

# Build the CLI
bun run build

# Run tests
bun test

# Type check
bun run typecheck
```

## Release

To publish a new version to npm:

```bash
# Create release (bumps version and git tag)
bun run release                 # patch (0.1.0 → 0.1.1)
bun run release -- --release-as minor  # minor (0.1.0 → 0.2.0)
bun run release -- --release-as major  # major (0.1.0 → 1.0.0)
bun run release -- --release-as 1.2.3  # specific version
```

Then manually trigger the publish workflow in GitHub Actions with the version number.

## License

MIT
