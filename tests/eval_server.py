"""Local server for the TrueFrame evaluation harness.

Serves the site from the project root, a folder of labelled test files under /__data/,
and accepts POST /__results?name=<name> (JSON) which is written to <results_dir>/<name>.json.

Usage:
    python tests/eval_server.py <data_dir> <results_dir> [port]
Then open http://localhost:<port>/tests/harness.html?manifest=/__data/manifest.json&base=/__data/
"""
import http.server
import json
import os
import re
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.abspath(sys.argv[1])
RESULTS = os.path.abspath(sys.argv[2])
PORT = int(sys.argv[3]) if len(sys.argv) > 3 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = urllib.parse.unquote(urllib.parse.urlparse(path).path)
        if p.startswith("/__data/"):
            rel = p[len("/__data/"):]
            full = os.path.abspath(os.path.join(DATA, rel))
            return full if full.startswith(DATA) else DATA
        rel = p.lstrip("/")
        full = os.path.abspath(os.path.join(ROOT, rel))
        return full if full.startswith(ROOT) else ROOT

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/__results":
            self.send_error(404)
            return
        name = urllib.parse.parse_qs(u.query).get("name", ["results"])[0]
        name = re.sub(r"[^A-Za-z0-9_.-]", "_", name)
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        os.makedirs(RESULTS, exist_ok=True)
        with open(os.path.join(RESULTS, name + ".json"), "wb") as f:
            f.write(body)
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet
        pass


if __name__ == "__main__":
    print(f"serving {ROOT} (+ /__data/ -> {DATA}) on http://localhost:{PORT}", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
