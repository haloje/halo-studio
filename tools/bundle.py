"""Pack docs/ into the zip the iPhone app downloads.

The zip is byte-for-byte reproducible (sorted names, fixed dates, no compression), so build.py can
record its SHA-256 in docs/app/latest.json and the GitHub workflow rebuilds exactly the same file.
The app's updater refuses a bundle without a matching checksum.

    python3 tools/bundle.py out.zip    # writes the zip and prints its sha256
"""
import hashlib, io, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
SKIP_DIRS = {"promo"}
SKIP_FILES = {"app/latest.json"}


def files():
    """Files git tracks under docs/ (plus the ones build.py writes), so a local build and the
    workflow's checkout pack exactly the same set."""
    import subprocess
    try:
        tracked = subprocess.run(["git", "ls-files", "docs"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
        paths = {ROOT / t for t in tracked} | {DOCS / "index.html", DOCS / "sw.js", DOCS / "app/version.json"}
    except Exception:
        paths = set(DOCS.rglob("*"))
    out = []
    for p in paths:
        if not p.is_file():
            continue
        rel = p.relative_to(DOCS).as_posix()
        if rel.split("/")[0] in SKIP_DIRS or rel in SKIP_FILES or p.name.startswith("."):
            continue
        out.append(rel)
    return sorted(out)


def make_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for rel in files():
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.create_system = 3
            z.writestr(info, (DOCS / rel).read_bytes())
    return buf.getvalue()


if __name__ == "__main__":
    data = make_zip()
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_bytes(data)
    print(hashlib.sha256(data).hexdigest())
