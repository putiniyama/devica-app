#!/usr/bin/env python3
"""
Запуск: python3 server.py
Переменные окружения:
  HOST=0.0.0.0   адрес прослушивания  (по умолчанию 0.0.0.0)
  PORT=8787      порт                  (по умолчанию 8787)
"""
import os, json, urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

# загрузить .env если есть
_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
if os.path.isfile(_env):
    with open(_env) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

PORT     = int(os.environ.get('PORT', 8787))
HOST     = os.environ.get('HOST', '0.0.0.0')
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SOUND    = os.path.join(BASE_DIR, 'sound')


def safe(name):
    """True если имя файла не содержит path-traversal."""
    return name and '/' not in name and '\\' not in name and '..' not in name


class Handler(SimpleHTTPRequestHandler):

    # ── статика ────────────────────────────────────────────────────
    def do_GET(self):
        if self.path == '/api/songs':
            self._json(sorted(
                f for f in os.listdir(SOUND)
                if os.path.isfile(os.path.join(SOUND, f))
            ))
        else:
            super().do_GET()

    # ── загрузка файла  PUT /api/songs/<filename> ──────────────────
    def do_PUT(self):
        filename = urllib.parse.unquote(self.path.removeprefix('/api/songs/'))
        if not safe(filename):
            return self._err(400, 'Bad filename')
        size = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(size)
        os.makedirs(SOUND, exist_ok=True)
        with open(os.path.join(SOUND, filename), 'wb') as f:
            f.write(data)
        self._json({'ok': True})

    # ── удаление  DELETE /api/songs/<filename> ─────────────────────
    def do_DELETE(self):
        filename = urllib.parse.unquote(self.path.removeprefix('/api/songs/'))
        if not safe(filename):
            return self._err(400, 'Bad filename')
        path = os.path.join(SOUND, filename)
        if not os.path.isfile(path):
            return self._err(404, 'Not found')
        os.remove(path)
        self._json({'ok': True})

    # ── переименование  POST /api/rename ──────────────────────────
    def do_POST(self):
        if self.path != '/api/rename':
            return self._err(404, 'Not found')
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        old, new = body.get('old', ''), body.get('new', '')
        if not safe(old) or not safe(new):
            return self._err(400, 'Bad filename')
        src = os.path.join(SOUND, old)
        dst = os.path.join(SOUND, new)
        if not os.path.isfile(src):
            return self._err(404, 'Not found')
        os.rename(src, dst)
        self._json({'ok': True})

    # ── CORS preflight ─────────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # ── утилиты ───────────────────────────────────────────────────
    def _json(self, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        self.send_error(code, msg)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, fmt, *args):
        print(f'  {args[0]}  {args[1]}')


if __name__ == '__main__':
    os.makedirs(SOUND, exist_ok=True)
    display = 'localhost' if HOST in ('0.0.0.0', '') else HOST
    print(f'\n  HOST={HOST}  PORT={PORT}')
    print(f'  Сервер запущен → http://{display}:{PORT}/')
    print(f'  Приложение     → http://{display}:{PORT}/index.html')
    print(f'  Админка        → http://{display}:{PORT}/admin.html')
    print(f'  Остановить: Ctrl+C\n')
    HTTPServer((HOST, PORT), Handler).serve_forever()
