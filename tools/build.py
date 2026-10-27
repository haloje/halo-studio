"""Builds docs/index.html (the deployed app) from src/studio.html."""
import re, sys, hashlib, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / "src/studio.html").read_text(encoding="utf8")

def rep(s, a, b, count=1):
    n = s.count(a)
    if n != count: sys.exit(f"build: expected {count} of {a[:70]!r}, found {n}")
    return s.replace(a, b)

s = src
# remove the claude.ai-only bits
s = re.sub(r'<title>.*?</title>\s*', '', s, count=1)
s = re.sub(r'<meta name="claude:viewport-fit-sides"[^>]*>\s*', '', s)
s = re.sub(r'<link rel="preconnect"[^>]*>\s*', '', s)
FL = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400&family=Hanken+Grotesk:wght@400;500;600&family=Geist+Mono:wght@400&display=swap">'
i = s.index(FL); s = s[:i] + s[i+len(FL):]   # drop the page's own link (fonts are self-hosted); keep the one inside the HTML export
s = re.sub(r'<script>\(function\(\)\{var h=location\.hash.*?</script>\s*', '', s, count=1, flags=re.S)
for lib, local in [("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", "vendor/html2canvas.min.js"),
                   ("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", "vendor/jspdf.umd.min.js"),
                   ("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "vendor/pdf.min.js"),
                   ("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js", "vendor/pdf.worker.min.js")]:
    s = rep(s, lib, local)

fonts = """<style>
@font-face{font-family:"Outfit";font-weight:300;font-display:swap;src:url(fonts/outfit-latin-300-normal.woff2) format("woff2")}
@font-face{font-family:"Outfit";font-weight:400;font-display:swap;src:url(fonts/outfit-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"Hanken Grotesk";font-weight:400;font-display:swap;src:url(fonts/hanken-grotesk-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"Hanken Grotesk";font-weight:500;font-display:swap;src:url(fonts/hanken-grotesk-latin-500-normal.woff2) format("woff2")}
@font-face{font-family:"Hanken Grotesk";font-weight:600;font-display:swap;src:url(fonts/hanken-grotesk-latin-600-normal.woff2) format("woff2")}
@font-face{font-family:"Hanken Grotesk";font-weight:700;font-display:swap;src:url(fonts/hanken-grotesk-latin-700-normal.woff2) format("woff2")}
@font-face{font-family:"Geist Mono";font-weight:400;font-display:swap;src:url(fonts/geist-mono-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"Geist Mono";font-weight:700;font-display:swap;src:url(fonts/geist-mono-latin-700-normal.woff2) format("woff2")}
html,body{margin:0;height:100%}
</style>"""

head = f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>halo.je Studio</title>
<meta name="theme-color" content="#121110">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Studio">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
{fonts}
<script src="vendor/supabase-2.45.4.js"></script>
<script src="backend.js"></script>
</head>
<body>
"""
tail = """
<script>if("serviceWorker" in navigator){addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));}</script>
</body>
</html>
"""
out = head + s + tail
(ROOT / "docs/index.html").write_text(out, encoding="utf8")
ver = hashlib.sha1(out.encode() + (ROOT / "docs/backend.js").read_bytes()).hexdigest()[:10]
sw = (ROOT / "tools/sw.template.js").read_text().replace("__VERSION__", ver)
(ROOT / "docs/sw.js").write_text(sw)
print("built docs/index.html", len(out), "bytes, cache", ver)
