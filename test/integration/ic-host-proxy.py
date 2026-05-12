#!/usr/bin/env python3
"""
HTTP reverse proxy that rewrites the Host header to "localhost".
Used to let Docker containers (host.docker.internal) reach icp-cli's
HTTP gateway, which only accepts "localhost" as a valid Host.

Usage: python3 ic-host-proxy.py <listen_port> <target_port>
"""
import sys, socket
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request, urllib.error

LISTEN_PORT = int(sys.argv[1])
TARGET_PORT = int(sys.argv[2])
TARGET_URL  = f"http://127.0.0.1:{TARGET_PORT}"


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress per-request logs

    def _forward(self):
        url = f"{TARGET_URL}{self.path}"

        # Build forwarded headers, rewriting Host → localhost
        fwd_headers = {}
        for key, val in self.headers.items():
            if key.lower() == "host":
                fwd_headers["Host"] = "localhost"
            elif key.lower() not in ("connection", "keep-alive", "proxy-connection"):
                fwd_headers[key] = val
        fwd_headers.setdefault("Host", "localhost")

        # Read body if present
        body = None
        cl = self.headers.get("Content-Length")
        if cl:
            body = self.rfile.read(int(cl))

        req = urllib.request.Request(
            url, data=body, headers=fwd_headers, method=self.command
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                self.send_response(resp.status)
                for k, v in resp.headers.items():
                    if k.lower() not in ("transfer-encoding", "connection"):
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(resp.read())
        except urllib.error.HTTPError as exc:
            self.send_response(exc.code)
            for k, v in exc.headers.items():
                if k.lower() not in ("transfer-encoding", "connection"):
                    self.send_header(k, v)
            self.end_headers()
            body = exc.read()
            if body:
                self.wfile.write(body)
        except Exception as exc:
            sys.stderr.write(f"proxy error: {exc}\n")
            sys.stderr.flush()
            self.send_error(502, str(exc))

    do_GET    = _forward
    do_POST   = _forward
    do_PUT    = _forward
    do_DELETE = _forward
    do_PATCH  = _forward
    do_HEAD   = _forward


class DualStackServer(HTTPServer):
    """HTTPServer that listens on IPv6 dual-stack (accepts IPv4 and IPv6)."""
    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(
                socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0
            )
        except (AttributeError, OSError):
            pass
        super().server_bind()


server = DualStackServer(("::", LISTEN_PORT), ProxyHandler)
sys.stdout.write(
    f"ic-host-proxy: :{LISTEN_PORT} -> localhost:{TARGET_PORT}\n"
)
sys.stdout.flush()
server.serve_forever()
