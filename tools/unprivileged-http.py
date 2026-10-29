"""Local test server: real filesystem access as an unprivileged user, two requests."""
import http.server, sys
from pathlib import Path
root = Path(sys.argv[1])
allowed = {
 "/luci-static/resources/view/site-checker2/overview.js",
 "/luci-static/resources/view/site-checker2/style.css",
}
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        target = self.path.split("?", 1)[0]
        if target not in allowed:
            self.send_error(404)
            return
        try:
            data = (root / target.lstrip("/")).read_bytes()
        except PermissionError:
            self.send_error(403)
            return
        except FileNotFoundError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *args):
        pass
server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
server.timeout = 5
print(server.server_port, flush=True)
try:
    for _ in range(2):
        server.handle_request()
finally:
    server.server_close()
