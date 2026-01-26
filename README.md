# Quick User Switcher

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for Steam Deck that simplifies switching between Steam accounts.

## Features

- **Quick Account Switching**: Switch between Steam accounts directly from the Quick Access Menu
- **Smart Game Detection**: Detects when a game is owned by a different account and offers one-click switching
- **Switch & Play**: Automatically launches games after switching to the correct account
- **No More "Borrow" Dialogs**: Bypass the tedious borrow button when accessing Family Shared games on the same device

## Screenshots

<!-- TODO: Add screenshots -->

## Installation

### From the Decky Plugin Store (Recommended)

1. Open the Quick Access Menu (QAM) on your Steam Deck
2. Navigate to the Decky Loader plugin tab (plug icon)
3. Open the plugin store
4. Search for "Quick User Switcher" and install

### Manual Installation

1. Download the latest release from the [Releases](https://github.com/nikitaclicks/decky-multi-user/releases) page
2. Extract to `~/homebrew/plugins/`
3. Restart Decky Loader

## Development

### Prerequisites

- Node.js v18+
- pnpm v9+
- [Decky CLI](https://github.com/SteamDeckHomebrew/cli)

### Setup

```bash
# Install dependencies
pnpm install

# Build the plugin
pnpm run build
```

### Development Workflow

```bash
# Watch mode for development
pnpm run watch

# Deploy to Steam Deck (requires VS Code tasks setup)
# See .vscode/tasks.json for available tasks
```

## How It Works

The plugin works by:
1. Reading Steam's `loginusers.vdf` to enumerate available accounts
2. Modifying `registry.vdf` to set the AutoLoginUser for switching
3. Restarting Steam to apply the account change
4. Optionally queuing a game launch after the switch completes

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

BSD-3-Clause - see [LICENSE](LICENSE) for details.