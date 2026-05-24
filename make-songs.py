#!/usr/bin/env python3
"""
Запусти после добавления/удаления файлов в папке sound/:
  python3 make-songs.py

Создаёт sound/songs.json который читает приложение.
"""
import os, json, re

BASE  = os.path.dirname(os.path.abspath(__file__))
SOUND = os.path.join(BASE, 'sound')
EXTS  = {'mp3', 'ogg', 'wav', 'm4a', 'aac'}

songs = []
for f in sorted(os.listdir(SOUND)):
    if not os.path.isfile(os.path.join(SOUND, f)):
        continue
    m = re.match(r'^(\d+)(?:\((.+)\))?\.(\w+)$', f, re.IGNORECASE)
    if not m:
        continue
    num, name, ext = int(m[1]), m[2] or '', m[3].lower()
    if num < 1 or num > 9 or ext not in EXTS:
        continue
    songs.append({'num': num, 'name': name, 'file': f})

songs.sort(key=lambda s: s['num'])

out = os.path.join(SOUND, 'songs.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(songs, f, ensure_ascii=False, indent=2)

print(f'Записано {len(songs)} песен → sound/songs.json')
for s in songs:
    print(f"  {s['num']}. {s['name'] or '(без названия)'}  ←  {s['file']}")
