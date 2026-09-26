#!/bin/sh
# Demo installer: normal build + bundled test data (tools/demo-data.sqlite from tools/seed-data.mjs), all
# features unlocked, own data folder («Meena Time Demo»). Login: أ / 1234
#   sh tools/build-demo.sh → dist/Meena-Time-Demo-Setup-<version>.exe
set -e
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
xvfb-run -a node tools/seed-data.mjs
mkdir -p demo && cp tools/demo-data.sqlite demo/demo-data.sqlite
npx electron-builder --win dir --x64
(cd installer && makensis -DVERSION="$V" installer.nsi)
mv "dist/Meena-Time-Setup-$V.exe" "dist/Meena-Time-Demo-Setup-$V.exe"
rm -rf demo
echo "→ dist/Meena-Time-Demo-Setup-$V.exe"
