"""
eBay OAuth 用: 127.0.0.1:8765 で /ebay/callback を待ち受け、?code= を画面表示する。
ngrok 等で https 公開したうえで、その https URL を eBay の「認証が承認されました URL」と redirect_uri に使う。
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs


PORT = 8765
PATH = "/ebay/callback"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {format % args}")

    def do_GET(self):
        parsed = urlparse(self.path)
        norm = parsed.path.rstrip("/") or "/"
        if norm != PATH.rstrip("/"):
            self.send_error(404, "Use PATH " + PATH)
            return
        qs = parse_qs(parsed.query)
        code = (qs.get("code") or [""])[0]
        state = (qs.get("state") or [""])[0]
        err = (qs.get("error") or [""])[0]

        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.end_headers()
        body = f"""<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>eBay OAuth callback</title></head>
<body>
<h1>eBay OAuth コールバック</h1>
<p><strong>code:</strong> <code style="word-break:break-all;">{code or '(なし)'}</code></p>
<p><strong>state:</strong> <code>{state or '(なし)'}</code></p>
<p><strong>error:</strong> <code>{err or '(なし)'}</code></p>
<p>トークン交換には <code>code</code> が必要です。アドレスバーの URL 全文も保存してください。</p>
</body></html>"""
        self.wfile.write(body.encode("utf-8"))


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Listening http://127.0.0.1:{PORT}{PATH}")
    print("Stop: Ctrl+C")
    server.serve_forever()
