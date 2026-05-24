#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

# ── утилиты ───────────────────────────────────────────────────────
update_songs() {
    python3 "$DIR/make-songs.py"
}

snapshot() {
    ls "$DIR/sound/" 2>/dev/null | sort | tr '\n' '|'
}

start_server() {
    local port="${PORT:-8787}"
    echo ""
    echo "  Сервер:  http://localhost:$port/"
    echo "  Авто-обновление songs.json при изменении sound/"
    echo "  Остановить: Ctrl+C"
    echo ""

    update_songs

    # HTTP-сервер в фоне
    python3 -m http.server "$port" --bind 0.0.0.0 --directory "$DIR" &
    SERVER_PID=$!

    # Слежка за папкой sound/
    local last
    last=$(snapshot)
    while kill -0 "$SERVER_PID" 2>/dev/null; do
        sleep 2
        current=$(snapshot)
        if [ "$current" != "$last" ]; then
            last="$current"
            echo ""
            echo "  Изменения в sound/ — обновляю список..."
            update_songs
        fi
    done
}

# Остановить сервер при Ctrl+C
cleanup() {
    echo ""
    echo "  Остановка..."
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
    exit 0
}
trap cleanup INT TERM

# ── меню ──────────────────────────────────────────────────────────
while true; do
    echo ""
    echo "  ╔══════════════════════════════╗"
    echo "  ║         ДЕВИЦА               ║"
    echo "  ╚══════════════════════════════╝"
    echo ""
    echo "  1. Запустить сервер (авто-обновление песен)"
    echo "  2. Обновить список песен вручную"
    echo "  0. Выход"
    echo ""
    read -rp "  Выбор: " choice

    case $choice in
        1) start_server ;;
        2) echo "" && update_songs ;;
        0) echo "" && exit 0 ;;
        *) echo "  Неверный выбор" ;;
    esac
done
