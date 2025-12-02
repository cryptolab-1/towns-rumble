#!/bin/bash
set -e

# Install Bun if not already installed
if ! command -v bun &> /dev/null; then
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Run the bot
echo "Starting Towns Rumble bot..."
bun run src/index.ts

