# Iranti Control Plane - Dev Setup (Windows PowerShell)
# Run from the repo root: .\scripts\dev-setup.ps1

Write-Host "=== Iranti Control Plane - Dev Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try {
    $nodeVersion = (node --version 2>&1).TrimStart('v').Split('.')[0]
    if ([int]$nodeVersion -lt 18) {
        Write-Host "ERROR: Node.js v18+ required (found v$nodeVersion). Install from https://nodejs.org" -ForegroundColor Red
        exit 1
    }
    Write-Host "OK: Node.js $(node --version)" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js not found. Install from https://nodejs.org (v20+)" -ForegroundColor Red
    exit 1
}

# Check npm
try {
    $npmVersion = npm --version 2>&1
    Write-Host "OK: npm $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: npm not found. It should ship with Node.js." -ForegroundColor Red
    exit 1
}

# Must be run from repo root
if (-not (Test-Path "src/server/package.json") -or -not (Test-Path "src/client/package.json")) {
    Write-Host ""
    Write-Host "ERROR: Run this script from the repo root (iranti-control-plane\)." -ForegroundColor Red
    Write-Host "  Example: .\scripts\dev-setup.ps1"
    exit 1
}

# Check for .env.iranti
if (-not (Test-Path ".env.iranti")) {
    Write-Host ""
    Write-Host "WARNING: No .env.iranti found." -ForegroundColor Yellow
    Write-Host "  Create one at the repo root with at minimum:"
    Write-Host "    DATABASE_URL=postgresql://user:password@localhost:5432/iranti"
    Write-Host ""
    Write-Host "  If you don't have a PostgreSQL instance, start one with Docker:"
    Write-Host "    docker compose up -d"
    Write-Host "  Then add:"
    Write-Host "    DATABASE_URL=postgresql://iranti:iranti@localhost:5432/iranti"
    Write-Host ""
}

# Install server deps
Write-Host "Installing server dependencies..."
npm install --prefix src/server
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Server dep install failed." -ForegroundColor Red; exit 1 }
Write-Host "OK: Server deps installed" -ForegroundColor Green

# Install client deps
Write-Host "Installing client dependencies..."
npm install --prefix src/client
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Client dep install failed." -ForegroundColor Red; exit 1 }
Write-Host "OK: Client deps installed" -ForegroundColor Green

# Install root deps (provides concurrently for npm run dev)
Write-Host "Installing root dependencies..."
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Root dep install failed." -ForegroundColor Red; exit 1 }
Write-Host "OK: Root deps installed" -ForegroundColor Green

Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "To start development (server + client together):"
Write-Host "  npm run dev                        # both server and client (recommended)"
Write-Host ""
Write-Host "To run each process individually:"
Write-Host "  npm run dev --prefix src/server   # server only (port 3002)"
Write-Host "  npm run dev --prefix src/client   # client only (port 5173)"
Write-Host ""
Write-Host "To run migrations (creates required tables):"
Write-Host "  npm run migrate"
Write-Host ""
