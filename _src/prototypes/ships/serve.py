#!/usr/bin/env python3
"""Static server for the ship prototype; POST /answers saves the reviewer's choices to answers.json."""
import json, os, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def do_POST(self):
        if self.path != "/answers":
            self.send_error(404); return
        n = int(self.headers.get("Content-Length", "0") or 0)
        if n > 20000:
            self.send_error(413); return
        try:
            data = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            self.send_error(400); return
        keep = {k: str(data.get(k, ""))[:4000] for k in ("ship", "end", "note", "savedAt")}
        tmp = os.path.join(ROOT, "answers.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(keep, f, ensure_ascii=False, indent=2)
        os.replace(tmp, os.path.join(ROOT, "answers.json"))
        self.send_response(204); self.end_headers()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4178
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
