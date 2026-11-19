#!/usr/bin/env python
"""The one-time setup of the Chrome Web Store access file (~/.prism/chrome-webstore.json), without the OAuth Playground.

    python scripts/release/chrome-store-access.py --client <client_secret_....json> --publisher <publisher id>

- --client is the file Google Cloud gives for an OAuth client of the type "Desktop app" (Download JSON).
- The script opens Google's own consent page in the browser. The owner signs in there and allows the one permission
  (https://www.googleapis.com/auth/chromewebstore). Google sends the answer to this PC alone (127.0.0.1), the script trades it for a
  refresh token and writes the four values to ~/.prism/chrome-webstore.json. It prints none of them.
- Nothing is uploaded. `python scripts/release/publish-chrome.py --status` then reads the store's state with the new file.
"""
import argparse, http.server, io, json, os, secrets, sys, urllib.parse, urllib.request, webbrowser

ap = argparse.ArgumentParser()
ap.add_argument("--client", required=True)
ap.add_argument("--publisher", required=True)
ap.add_argument("--no-browser", action="store_true", help="print the address instead of opening it")
a = ap.parse_args()
OUT = os.path.expanduser("~/.prism/chrome-webstore.json")
with io.open(a.client, encoding="utf-8") as f: c = json.load(f)
c = c.get("installed") or c.get("web") or c
if not c.get("client_id") or not c.get("client_secret"): sys.exit("%s has no client_id and client_secret" % a.client)

state = secrets.token_urlsafe(16); got = {}


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if q.get("state", [""])[0] == state: got.update(code=q.get("code", [""])[0], error=q.get("error", [""])[0])
        self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
        self.wfile.write(b"<body style='font:18px Segoe UI;background:#14171C;color:#F2F4F7;padding:40px'>PRISM has the answer. You can close this tab.</body>")

    def log_message(self, *x): pass


srv = http.server.HTTPServer(("127.0.0.1", 0), H); srv.timeout = 600
redirect = "http://127.0.0.1:%d/" % srv.server_address[1]
url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({"client_id": c["client_id"], "redirect_uri": redirect, "response_type": "code",
    "scope": "https://www.googleapis.com/auth/chromewebstore", "access_type": "offline", "prompt": "consent", "state": state})
print("waiting for Google's consent page (ten minutes at most)", flush=True)
if a.no_browser: print("open: " + url.split("client_id=")[0] + "... (written to the file beside this line)", flush=True)
if a.no_browser:
    with io.open(os.path.join(os.path.dirname(OUT), "chrome-consent-url.txt"), "w", encoding="utf-8") as f: f.write(url)
else: webbrowser.open(url)
while not got: srv.handle_request()
if got.get("error") or not got.get("code"): sys.exit("Google gave no code: %s" % (got.get("error") or "no answer"))
form = urllib.parse.urlencode({"code": got["code"], "client_id": c["client_id"], "client_secret": c["client_secret"], "redirect_uri": redirect, "grant_type": "authorization_code"}).encode()
try:
    with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=form), timeout=60) as r: tok = json.loads(r.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    sys.exit("Google refused the exchange: HTTP %d %s" % (e.code, e.read().decode("utf-8", "replace")[:300]))
if not tok.get("refresh_token"): sys.exit("Google gave no refresh token (remove PRISM's access on myaccount.google.com/permissions and run again)")
# the file can publish to the store account: made for its owner alone from the start (on Windows the profile folder's own
# permissions already keep other accounts out; the mode is what other systems go by)
os.makedirs(os.path.dirname(OUT), mode=0o700, exist_ok=True)
with os.fdopen(os.open(OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
    json.dump({"client_id": c["client_id"], "client_secret": c["client_secret"], "refresh_token": tok["refresh_token"], "publisher_id": a.publisher.strip()}, f, indent=1)
print("written: %s (four values, none printed)" % OUT)
