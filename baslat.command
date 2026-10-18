#!/bin/sh
# macOS: çift tıklayın. Linux: terminalde `sh baslat.command`
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  printf "\n  Node.js bulunamadı. https://nodejs.org adresinden LTS sürümünü kurun.\n\n"
  exit 1
fi

[ -d node_modules ] || { echo "  Bağımlılıklar kuruluyor..."; npm install || exit 1; }
[ -f .env ] || npm run setup || exit 1

PORT_NUM=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)
URL="http://localhost:${PORT_NUM:-3000}"
( sleep 2; if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi ) >/dev/null 2>&1 &

npm start
