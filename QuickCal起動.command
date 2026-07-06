#!/bin/zsh
# QuickCal起動 — ダブルクリックでローカルサーバーを立ち上げてブラウザで開く
# (Google連携は http://localhost:8934 で開いたときだけ使える仕様のため)
cd "$(dirname "$0")"
if ! lsof -nP -iTCP:8934 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3.12 -m http.server 8934 >/dev/null 2>&1 &
  sleep 1
fi
open "http://localhost:8934"
