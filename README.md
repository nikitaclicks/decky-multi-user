# Decky Multi-User Manager

A Decky Loader plugin to simplify switching between user accounts on the Steam Deck.

## Features

- **Quick Account Switching**: Switch accounts directly from the library or quick access menu (planned).
- **Avoid "Borrow" Dialog**: Bypass the "borrow" button prompt when accessing games shared across accounts on the same device.

## Installation

### From the Decky Store

1. Open the Quick Access Menu (QAM) on your Steam Deck.
2. Go to the Decky Loader plugin tab (the plug icon).
3. Select the store icon.
4. Search for "Multi-User Manager" and install.

### Manual Installation

1. Clone this repository.
2. Run `pnpm i` to install dependencies.
3. Run `pnpm run build` to build the plugin.
4. Copy the resulting folder (or use the Decky CLI) to your Steam Deck's plugin directory (`~/homebrew/plugins`).

## Development

### Prerequisites

- Node.js v16.14+
- pnpm v9
- Python (for backend)

### Building

```bash
pnpm install
pnpm run build
```

To watch for changes during development:

```bash
pnpm run watch
```

## License

BSD-3-Clause