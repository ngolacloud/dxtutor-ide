import os
from http.server import BaseHTTPRequestHandler, HTTPServer


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == "/healthz" else 404)
        self.end_headers()


if __name__ == "__main__":
    assert os.environ.get("DB_PASSWORD"), "DB_PASSWORD is required"
    HTTPServer(("0.0.0.0", 8000), H).serve_forever()
