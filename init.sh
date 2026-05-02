#!/bin/bash
echo "=== Tharros Init ==="
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi
if [ ! -f ".env.local" ]; then
  echo "WARNING: .env.local not found. Copy .env.example and fill in keys."
fi
echo "Starting dev server at http://localhost:3000"
npm run dev
