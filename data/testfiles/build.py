#!/usr/bin/env python3
"""Regenerates the sample files in this directory.

Everything here is generated rather than hand-written, so a value that has to
be consistent across nine files (the two accent colours, the page shell, the
entry-page names) is written down once. Run it from anywhere:

    python3 data/testfiles/build.py            # the committed material
    python3 data/testfiles/build.py --large    # plus the two oversize files

The oversize files are hundreds of megabytes and stay out of the repository;
`--large` writes them when you need them and leaves them alone otherwise.
"""

import binascii
import os
import shutil
import struct
import sys
import zipfile
import zlib

ROOT = os.path.dirname(os.path.abspath(__file__))

# Everything the generator owns. A rebuild replaces exactly these and leaves
# README.md, this script and any ignored oversize file where they are.
GENERATED = (
    "1-single-html",
    "2-single-pdf",
    "3-zip-one-html",
    "4-zip-many-html",
    "5-refused",
)

# The two states a pair switches between. `a` is the light one, `b` the dark
# one, and the accent is what the page's letter and its square are painted in —
# so a state that failed to switch is visible at a glance, not only readable.
STATES = {
    "A": {"ink": "#1F1D1A", "ground": "#FAF8F4", "accent": "#2A5A73", "word": "STATE A"},
    "B": {"ink": "#FAF8F4", "ground": "#1A1917", "accent": "#D9736A", "word": "STATE B"},
}

# The three pages of the ambiguous archive, and the same three after the entry
# page was renamed. Root first, then folders — the order the entry chooser
# itself sorts them into.
PAGES = [
    ("overview.html", "overview"),
    ("chapter-01/page.html", "chapter 1"),
    ("chapter-02/page.html", "chapter 2"),
]
PAGES_RENAMED = [("summary.html", "summary")] + PAGES[1:]


def styles(state, indent=""):
    s = STATES[state]
    body = f"""html {{ color-scheme: {"light" if state == "A" else "dark"}; }}
body {{ margin: 0; min-height: 100vh; display: grid; place-items: center;
       background: {s["ground"]}; color: {s["ink"]};
       font: 400 16px/1.5 system-ui, sans-serif; }}
main {{ text-align: center; padding: 48px 24px; }}
h1 {{ margin: 0; font-size: 22vw; line-height: 0.9; font-weight: 600;
     color: {s["accent"]}; letter-spacing: -0.04em; }}
p {{ margin: 16px 0 0; }}
.sub {{ font-size: 20px; }}
.links {{ list-style: none; padding: 0; margin: 32px 0 0; display: flex;
         gap: 20px; justify-content: center; flex-wrap: wrap; }}
.links a {{ color: {s["accent"]}; }}
.asset {{ opacity: 0.7; font-size: 14px; display: flex; gap: 10px;
         align-items: center; justify-content: center; }}
.asset img {{ display: block; }}
"""
    if not indent:
        return body
    return "\n".join(indent + line if line else line for line in body.splitlines())


def page(state, heading, subline, links=(), asset=None, css=None):
    s = STATES[state]
    linkhtml = ""
    if links:
        items = "\n".join(f'      <li><a href="{href}">{label}</a></li>' for href, label in links)
        linkhtml = f'\n    <ul class="links">\n{items}\n    </ul>'
    assethtml = (
        f'\n    <p class="asset"><img src="{asset}" alt="" width="48" height="48"> '
        f"if this square is here, the artifact's own assets resolve too</p>"
        if asset
        else ""
    )
    head = (
        f'<link rel="stylesheet" href="{css}">'
        if css
        else f"\n    <style>\n{styles(state, '      ')}\n    </style>"
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{s["word"]} — {heading}</title>{head}
</head>
<body>
  <main>
    <h1>{state}</h1>
    <p class="sub">{s["word"]} · {heading}</p>
    <p>{subline}</p>{linkhtml}{assethtml}
  </main>
</body>
</html>
"""


def solid_png(hex_colour, size=64):
    """A real PNG: signature, IHDR, IDAT, IEND, each chunk with its own CRC.

    Written out rather than copied from somewhere, because a picture that is
    only a file signature renders as a broken image and would make the asset
    check say the opposite of the truth.
    """
    r, g, b = (int(hex_colour[i : i + 2], 16) for i in (1, 3, 5))
    raw = b"".join(b"\x00" + bytes([r, g, b]) * size for _ in range(size))

    def chunk(kind, payload):
        crc = binascii.crc32(kind + payload) & 0xFFFFFFFF
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def minimal_pdf(state):
    """A one-page PDF built by hand: no library, correct xref offsets."""
    s = STATES[state]
    r, g, b = (int(s["accent"][i : i + 2], 16) / 255 for i in (1, 3, 5))
    gr, gg, gb = (int(s["ground"][i : i + 2], 16) / 255 for i in (1, 3, 5))
    stream = (
        f"{gr:.3f} {gg:.3f} {gb:.3f} rg\n0 0 595 842 re f\n"
        f"{r:.3f} {g:.3f} {b:.3f} rg\n"
        f"BT /F1 300 Tf 200 400 Td ({state}) Tj ET\n"
        f"BT /F1 28 Tf 150 320 Td ({s['word']}) Tj ET\n"
        f"BT /F1 14 Tf 120 270 Td (Handout sample material - single PDF) Tj ET"
    ).encode("latin-1")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n"
    ).encode()
    return bytes(out)


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb" if isinstance(content, bytes) else "w") as fh:
        fh.write(content)


def zip_dir(src, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for base, _, files in os.walk(src):
            for name in sorted(files):
                full = os.path.join(base, name)
                zf.write(full, os.path.relpath(full, src))


def site(state, pages, staging, heading, subline):
    """One archive's tree: the pages, the stylesheet they share, the square."""
    shutil.rmtree(staging, ignore_errors=True)
    for rel, label in pages:
        up = "../" * rel.count("/")
        links = [(f"{up}{other}", lbl) for other, lbl in pages if other != rel]
        write(
            os.path.join(staging, rel),
            page(state, f"{heading} · {label}", subline, links=links,
                 asset=f"{up}assets/pixel.png", css=f"{up}style.css"),
        )
    write(os.path.join(staging, "style.css"), styles(state))
    write(os.path.join(staging, "assets/pixel.png"), solid_png(STATES[state]["accent"]))
    return staging


def build(staging):
    for sub in GENERATED:
        shutil.rmtree(os.path.join(ROOT, sub), ignore_errors=True)

    # 1 — one self-contained file, nothing to resolve
    for st in ("A", "B"):
        write(
            f"{ROOT}/1-single-html/{st.lower()}.html",
            page(st, "single HTML", "One self-contained file. The plainest update there is."),
        )

    # 2 — one PDF page
    for st in ("A", "B"):
        write(f"{ROOT}/2-single-pdf/{st.lower()}.pdf", minimal_pdf(st))

    # 3 — an archive that resolves on its own: index.html at the root
    for st in ("A", "B"):
        d = site(st, [("index.html", "entry")], f"{staging}/3-{st}",
                 "zip, one HTML", "Resolved without a question: index.html at the root.")
        zip_dir(d, f"{ROOT}/3-zip-one-html/{st.lower()}.zip")

    # 4 — an ambiguous archive: several pages, no index.html
    for st in ("A", "B"):
        d = site(st, PAGES, f"{staging}/4-{st}", "zip, several HTMLs",
                 "No index.html, so the entry page was chosen once and is kept.")
        zip_dir(d, f"{ROOT}/4-zip-many-html/{st.lower()}.zip")

    # 4c — the same archive after the entry page was renamed
    d = site("A", PAGES_RENAMED, f"{staging}/4-C", "zip, entry renamed",
             "overview.html is gone, so the entry page has to be chosen again.")
    zip_dir(d, f"{ROOT}/4-zip-many-html/c-entry-renamed.zip")

    # 5 — an archive with no page in it at all, which has to be refused
    d = f"{staging}/5-nohtml"
    shutil.rmtree(d, ignore_errors=True)
    write(f"{d}/notes.txt", "A zip with no page in it. Handout has to refuse this.\n")
    write(f"{d}/data.json", '{"why": "there is nothing here that could be shown"}\n')
    write(f"{d}/assets/pixel.png", solid_png("#8A8478"))
    zip_dir(d, f"{ROOT}/5-refused/no-html.zip")


def build_large():
    """The two oversize files, written on demand and never committed."""
    targets = [
        ("5-refused/too-large.html", 520, "over the 500 MB ceiling, has to be refused"),
        ("5-refused/progress-300mb.html", 300, "big enough to watch the progress bar move"),
    ]
    filler = ("<!-- " + "x" * 1013 + " -->\n").encode()
    for rel, megabytes, why in targets:
        path = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(f"<!DOCTYPE html>\n<title>{megabytes} MB — {why}</title>\n".encode())
            for _ in range((megabytes * 1024 * 1024) // len(filler)):
                fh.write(filler)
        print(f"  {rel:44} {os.path.getsize(path) / 1024 / 1024:>8.0f} MB")


def main():
    staging = os.path.join(ROOT, ".staging")
    try:
        build(staging)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    print("built:")
    for base, _, files in sorted(os.walk(ROOT)):
        for name in sorted(files):
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT)
            if rel.startswith(GENERATED):
                print(f"  {rel:44} {os.path.getsize(path):>8} B")

    if "--large" in sys.argv:
        print("oversize, not committed:")
        build_large()


if __name__ == "__main__":
    main()
