#!/bin/bash

while true; do
    echo ""
    echo "  ╔══════════════════════════════╗"
    echo "  ║         ДЕВИЦА               ║"
    echo "  ╚══════════════════════════════╝"
    echo ""
    echo "  1. Обновить список песен"
    echo "  0. Выход"
    echo ""
    read -rp "  Выбор: " choice

    case $choice in
        1)
            echo ""
            python3 "$(dirname "$0")/make-songs.py"
            ;;
        0)
            echo ""
            exit 0
            ;;
        *)
            echo "  Неверный выбор"
            ;;
    esac
done
