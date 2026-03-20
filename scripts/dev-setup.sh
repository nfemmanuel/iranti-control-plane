#!/usr/bin/env bash
set -e

echo "=== Iranti Control Plane — Dev Setup ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org (v20+)"
  exit 1
fi
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Node.js v18+ required (found v$NODE_VERSION)"
  exit 1
fi
echo "OK: Node.js $(node --version)"

# Check npm
if ! command -v npm &> /dev/null; then
  echo "ERROR: npm not found. It should ship with Node.js."
  exit 1
fi
echo "OK: npm $(npm --version)"

# Must be run from repo root
if [ ! -f "src/server/package.json" ] || [ ! -f "src/client/package.json" ]; then
  echo ""
  echo "ERROR: Run this script from the repo root (iranti-control-plane/)."
  echo "  Example: bash scripts/dev-setup.sh"
  exit 1
fi

# Check for .env.iranti
if [ ! -f ".env.iranti" ]; then
  echo ""
  echo "WARNING: No .env.iranti found."
  echo "  Create one at the repo root with at minimum:"
  echo "    DATABASE_URL=postgresql://user:password@localhost:5432/iranti"
  echo ""
  echo "  If you don't have a PostgreSQL instance, start one with Docker:"
  echo "    docker compose up -d"
  echo "  Then add:"
  echo "    DATABASE_URL=postgresql://iranti:iranti@localhost:5432/iranti"
  echo ""
fi

# Install server deps
echo "Installing server dependencies..."
npm install --prefix src/server
echo "OK: Server deps installed"

# Install client deps
echo "Installing client dependencies..."
npm install --prefix src/client
echo "OK: Client deps installed"

# Install root deps (provides concurrently for npm run dev)
echo "Installing root dependencies..."
npm install
echo "OK: Root deps installed"

echo ""
echo "=== Setup complete ==="
echo ""
echo "To start development (server + client together):"
echo "  npm run dev                        # both server and client (recommended)"
echo ""
echo "To run each process individually:"
echo "  npm run dev --prefix src/server   # server only (port 3002)"
echo "  npm run dev --prefix src/client   # client only (port 5173)"
echo ""
echo "To run migrations (creates required tables):"
echo "  npm run migrate"
echo ""
