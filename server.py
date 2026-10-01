"""Familiar Weather — tiny static server (stdlib only).

Run:  python server.py [--port 8123]
Serves index.html/styles.css/app.js with no-cache so edits show up instantly.
"""
import argparse
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter logs
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8123)
    args = ap.parse_args()
    print(f"Familiar Weather on http://127.0.0.1:{args.port}")
    HTTPServer(("0.0.0.0", args.port), Handler).serve_forever()
