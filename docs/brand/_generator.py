"""HAKA PRO logo system generator — outlined SVGs + PNG exports."""
import os, io, json, zipfile
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import cairosvg

FONT_DIR = "/home/claude/fonts/package/files"
OUT = "/home/claude/haka-pro-logo"

# ---------- Brand tokens ----------
C = {
    "deep": "#1E5F8C",   # Haka Deep (gradient start)
    "teal": "#12ADA6",   # Haka Teal (gradient mid / core brand)
    "mint": "#8FDCCB",   # Haka Mint (gradient end)
    "ink":  "#0B1C26",   # Ink (text on light, dark bg)
    "paper": "#F3F7F7",  # Paper (text on dark)
    "teal_dark": "#0B7F7B",  # PRO on light (AA-ish contrast)
    "night": "#081720",  # app icon background
}

def font(w):
    return TTFont(f"{FONT_DIR}/plus-jakarta-sans-latin-{w}-normal.woff")

def text_path(txt, w, size, tracking_em=0.0):
    """Return (svg path d, advance width, cap height) for text at baseline y=0."""
    f = font(w)
    gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f["head"].unitsPerEm
    cap = f["OS/2"].sCapHeight
    s = size / upm
    x = 0.0; ds = []
    for i, ch in enumerate(txt):
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (s, 0, 0, -s, x, 0))
        gs[g].draw(tp)
        ds.append(pen.getCommands())
        x += gs[g].width * s
        if i < len(txt) - 1:
            x += tracking_em * size
    return " ".join(ds), x, cap * s

# ---------- Symbol (400 x 400 grid, 180° rotationally symmetric) ----------
# Stems 52, gaps 84, core column 128, core split 88; negative space reads as an "H".
MARK = [
    "M0 0H52V320A52 120 0 0 1 0 200Z",                       # left stem
    "M136 0H240A24 24 0 0 1 264 24V156H136Z",                # core top
    "M264 400H160A24 24 0 0 1 136 376V244H264Z",             # core bottom
    "M400 400H348V80A52 120 0 0 1 400 200Z",                 # right stem
]
MARK_D = " ".join(MARK)

def grad_def(gid):
    return (f'<linearGradient id="{gid}" x1="0" y1="0" x2="400" y2="400" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{C["deep"]}"/><stop offset="0.55" stop-color="{C["teal"]}"/>'
            f'<stop offset="1" stop-color="{C["mint"]}"/></linearGradient>')

def mark_group(fill, x=0, y=0, scale=1.0):
    return f'<g transform="translate({x:.2f} {y:.2f}) scale({scale:.5f})"><path fill="{fill}" d="{MARK_D}"/></g>'

# ---------- Wordmark ----------
WM_SIZE = 200
HAKA_D, HAKA_W, CAP = text_path("HAKA", 700, WM_SIZE, 0.10)
PRO_D, PRO_W, _ = text_path("PRO", 500, WM_SIZE, 0.10)
GAP_HP = 0.30 * WM_SIZE   # HAKA→PRO spacing

def wordmark_group(c_haka, c_pro, x, y_base, scale):
    return (f'<g transform="translate({x:.2f} {y_base:.2f}) scale({scale:.5f})">'
            f'<path fill="{c_haka}" d="{HAKA_D}"/>'
            f'<path fill="{c_pro}" transform="translate({HAKA_W + GAP_HP:.2f} 0)" d="{PRO_D}"/></g>')
WM_W = HAKA_W + GAP_HP + PRO_W

def svg(w, h, body, defs="", title="HAKA PRO"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}">'
            f'<title>{title}</title>' + (f"<defs>{defs}</defs>" if defs else "") + body + "</svg>")

SCHEMES = {
    # name: (mark fill, haka color, pro color, uses gradient)
    "color-on-dark":  ("grad", C["paper"], C["mint"]),
    "color-on-light": ("grad", C["ink"], C["teal_dark"]),
    "mono-white":     ("#FFFFFF", "#FFFFFF", "#FFFFFF"),
    "mono-black":     ("#000000", "#000000", "#000000"),
    "mono-teal":      (C["teal_dark"], C["teal_dark"], C["teal_dark"]),
}

def resolve(fill, gid):
    return f"url(#{gid})" if fill == "grad" else fill

M = 400  # mark size unit
PAD = 0  # tight artboards; clear space is documented in guideline

def horizontal(scheme):
    mf, ch, cp = SCHEMES[scheme]
    s = 0.36 * M / CAP              # cap height = 36% of mark height
    gap = 0.30 * M                  # mark→wordmark gap
    w = M + gap + WM_W * s; h = M
    yb = M / 2 + CAP * s / 2        # optical centre on cap height
    body = mark_group(resolve(mf, "g"), 0, 0) + wordmark_group(ch, cp, M + gap, yb, s)
    return svg(w, h, body, grad_def("g") if mf == "grad" else "")

def stacked(scheme):
    mf, ch, cp = SCHEMES[scheme]
    s = 0.30 * M / CAP
    ww = WM_W * s; gap = 0.28 * M
    w = max(ww, M); h = M + gap + CAP * s
    body = mark_group(resolve(mf, "g"), (w - M) / 2, 0) + wordmark_group(ch, cp, (w - ww) / 2, h, s)
    return svg(w, h, body, grad_def("g") if mf == "grad" else "")

def mark_only(scheme):
    mf = SCHEMES[scheme][0]
    return svg(M, M, mark_group(resolve(mf, "g")), grad_def("g") if mf == "grad" else "", "HAKA PRO symbol")

def wordmark_only(scheme):
    _, ch, cp = SCHEMES[scheme]
    return svg(WM_W, CAP, wordmark_group(ch, cp, 0, CAP, 1.0), title="HAKA PRO wordmark")

def app_icon(bg, mf, size=1024, radius=0.225):
    inset = size * 0.22; ms = (size - 2 * inset) / M
    gid = "g"
    defs = grad_def(gid)
    rect = f'<rect width="{size}" height="{size}" rx="{size*radius:.1f}" fill="{bg}"/>' if bg else ""
    return svg(size, size, rect + mark_group(resolve(mf, gid), inset, inset, ms), defs, "HAKA PRO app icon")

def grad_bright(gid):
    return (f'<linearGradient id="{gid}" x1="0" y1="0" x2="400" y2="400" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="#2F8FC4"/><stop offset="0.5" stop-color="{C["teal"]}"/>'
            f'<stop offset="1" stop-color="{C["mint"]}"/></linearGradient>')

def favicon_svg():
    # square, full-bleed dark tile, slightly larger mark for small sizes
    size = 64; inset = 8; ms = (size - 2 * inset) / M
    return svg(size, size, f'<rect width="64" height="64" rx="14" fill="{C["night"]}"/>' +
               mark_group("url(#g)", inset, inset, ms), grad_bright("g"), "HAKA PRO")

# ---------- Write ----------
def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write(content)

def png(svg_str, path, width=None, height=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cairosvg.svg2png(bytestring=svg_str.encode(), write_to=path, output_width=width, output_height=height)

manifest = []
def emit(group, name, s, png_widths):
    sp = f"{OUT}/svg/{group}/{name}.svg"; write(sp, s); manifest.append(sp)
    for wpx in png_widths:
        pp = f"{OUT}/png/{group}/{name}@{wpx}w.png"; png(s, pp, width=wpx); manifest.append(pp)

if __name__ == "__main__":
    import shutil; shutil.rmtree(OUT, ignore_errors=True)
    for sch in SCHEMES:
        emit("horizontal", f"hakapro-horizontal-{sch}", horizontal(sch), [600, 1200, 2400])
        emit("stacked", f"hakapro-stacked-{sch}", stacked(sch), [400, 800, 1600])
        emit("wordmark", f"hakapro-wordmark-{sch}", wordmark_only(sch), [600, 1200, 2400])
    for sch in ["color-on-dark", "mono-white", "mono-black", "mono-teal"]:
        name = "color" if sch == "color-on-dark" else sch
        emit("symbol", f"hakapro-symbol-{name}", mark_only(sch), [64, 128, 256, 512, 1024, 2048])
    # app icons
    dark = app_icon(C["night"], "grad"); light = app_icon("#FFFFFF", "grad")
    emit("app-icon", "hakapro-appicon-dark", dark, [180, 192, 512, 1024])
    emit("app-icon", "hakapro-appicon-light", light, [180, 192, 512, 1024])
    emit("app-icon", "hakapro-appicon-dark-square", app_icon(C["night"], "grad", radius=0), [1024])
    fv = favicon_svg(); write(f"{OUT}/favicon/favicon.svg", fv)
    from PIL import Image
    sizes = [16, 32, 48]
    for sz in sizes + [64]:
        png(fv, f"{OUT}/favicon/favicon-{sz}.png", sz, sz)
    imgs = [Image.open(f"{OUT}/favicon/favicon-{sz}.png") for sz in [48]]
    imgs[0].save(f"{OUT}/favicon/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    png(dark, f"{OUT}/favicon/apple-touch-icon.png", 180, 180)
    json.dump({"colors": C, "font": "Plus Jakarta Sans (HAKA 700 / PRO 400, tracking +100)",
               "grid": "symbol 400u; stems 52u; gaps 84u; core 128u; core split 88u; corner r 24u; stem curve 52x120u ellipse"},
              open(f"{OUT}/tokens.json", "w"), indent=2)
    print(len(manifest), "files")
