#!/usr/bin/env python3
"""Dependency-free static development server. No application backend required."""
import functools
import http.server
import mimetypes
import os
from pathlib import Path

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")


class StaticHandler(http.server.SimpleHTTPRequestHandler):
    def log_request(self, code="-", size="-"):
        # Hundreds of sprite requests must not fill a persistent command pipe.
        # Keep errors visible; successful static responses need no per-file log.
        if isinstance(code, int) and code >= 400:
            super().log_request(code, size)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        super().do_GET()

    def send_head(self):
        # Never expose Git internals, hidden configuration, or directory listings.
        parts = Path(self.translate_path(self.path)).parts
        if any(part.startswith(".") for part in parts):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    try:
        port = int(os.environ.get("PORT", "3000"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise SystemExit("PORT must be an integer between 1 and 65535")
    handler = functools.partial(StaticHandler, directory=str(root))
    with http.server.ThreadingHTTPServer(("0.0.0.0", port), handler) as server:
        print(f"CENTURY: http://0.0.0.0:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
