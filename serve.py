#!/usr/bin/env python3
"""Minimal dev server — needed because ES modules don't work over file://."""
import http.server, socketserver, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args): pass   # silence request logs

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"  Open: http://localhost:{PORT}")
    print(f"  Stop: Ctrl+C\n")
    httpd.serve_forever()
