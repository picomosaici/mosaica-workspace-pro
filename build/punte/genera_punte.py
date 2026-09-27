# ============================================================
#  genera_punte.py — Mosaica Workspace Pro
#  Le punte «di fabbrica» della penna e dell'acquerello
#  (cantiere «Le Punte», Fetta 5, 27/09/2026)
# ------------------------------------------------------------
#  Uso (dalla cartella del repository):
#      python build/punte/genera_punte.py
#  Scrive le PNG in app/textures/penna/ e app/textures/brush/.
#  Serve Python 3 con numpy e Pillow (pip install numpy pillow).
#
#  Tutte 512×512, nero su trasparente: conta SOLO la trasparenza, il
#  colore lo dà Mosaica. Ogni punta ha il suo seme fisso: rilanciando lo
#  script le punte vengono uguali (con un'altra versione di Pillow i
#  byte del file possono cambiare, il disegno no).
#
#  PENNA  (textures/penna/): la parte larga in ORIZZONTALE a Rotazione 0.
#  ACQUERELLO (textures/brush/): l'acquerello gira sempre la punta nella
#  direzione del tratto, quindi la parte larga va in VERTICALE (così il
#  tratto viene largo senza i 90° nascosti di A12). Densità tarate su
#  watercolor-stamp: il motore sovrappone i timbri a strati, senza
#  normalizzarli, quindi più la punta è densa più l'acquerello è scuro.
# ============================================================
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

N = 512
yy, xx = np.mgrid[0:N, 0:N]
cx = cy = (N - 1) / 2
QUI = os.path.dirname(os.path.abspath(__file__))
RADICE = os.path.abspath(os.path.join(QUI, "..", ".."))


def salva(alfa, cartella, nome, tronca=False):
    a = np.clip(alfa, 0, 1)
    img = np.zeros((N, N, 4), np.uint8)
    img[..., 3] = (a * 255).astype(np.uint8) if tronca else (a * 255).round().astype(np.uint8)
    os.makedirs(cartella, exist_ok=True)
    Image.fromarray(img, "RGBA").save(os.path.join(cartella, nome + ".png"), optimize=True)


def sfoca(a, r):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(float) / 255


def rumore(rng, scala, liscio=1.0):
    """Rumore a macchie: celle di 'scala' px, ingrandite in bicubico."""
    n = max(2, N // scala)
    b = rng.random((n, n))
    im = Image.fromarray((b * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)
    a = np.asarray(im).astype(float) / 255
    return sfoca(a, liscio) if liscio > 0 else a


def fbm(rng, scale=(128, 64, 32, 16, 8), pesi=(0.4, 0.25, 0.17, 0.11, 0.07)):
    a = sum(p * rumore(rng, s, 0) for s, p in zip(scale, pesi))
    return (a - a.min()) / (a.max() - a.min())


# ────────────────────────── PENNA ──────────────────────────
def penna(dest):
    # Le prime tre sono le punte di prova della Fetta 4, rifatte uguali.
    # pennino-piatto: rettangolo netto, spigoli appena arrotondati.
    m = Image.new("L", (N * 4, N * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([4 * 36, 4 * 226, 4 * 476, 4 * 286], radius=4 * 10, fill=255)
    salva(np.asarray(m.resize((N, N), Image.LANCZOS)).astype(float) / 255, dest, "pennino-piatto")

    # grafite (e carboncino, stesso generatore: l'ordine conta per il seme)
    rng = np.random.default_rng(2026)
    r = np.hypot(xx - cx, yy - cy) / 220
    bordo = np.clip((1 - r) / 0.18, 0, 1) ** 1.2
    grana = rng.random((N, N))
    grana = np.asarray(Image.fromarray((grana * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255
    grana = np.clip((grana - 0.32) * 2.2, 0, 1)
    salva(bordo * (0.35 + 0.65 * grana), dest, "grafite")
    ang = np.deg2rad(-20)
    u = (xx - cx) * np.cos(ang) + (yy - cy) * np.sin(ang)
    v = -(xx - cx) * np.sin(ang) + (yy - cy) * np.cos(ang)
    theta = np.arctan2(v, u)
    rr = np.hypot(u / 230, v / 120) * (1 + 0.08 * np.sin(5 * theta) + 0.05 * np.sin(11 * theta + 1))
    forma = np.clip((1 - rr) / 0.12, 0, 1)
    righe = rng.random(N * 2)
    strie = np.interp((v + N).clip(0, 2 * N - 1), np.arange(2 * N),
                      np.asarray(Image.fromarray((righe * 255).astype(np.uint8).reshape(1, -1)).filter(ImageFilter.GaussianBlur(1.5))).astype(float)[0] / 255)
    strie = np.clip((strie - 0.25) * 1.8, 0, 1)
    buchi = np.clip((rng.random((N, N)) - 0.12) * 3, 0, 1)
    salva(forma * (0.25 + 0.75 * strie) * buchi, dest, "carboncino")

    # gessetto: corpo pieno, bordo irregolare, pochi buchi grossi.
    rng = np.random.default_rng(7)
    th = np.arctan2(yy - cy, xx - cx)
    r = np.hypot(xx - cx, yy - cy)
    raggio = 205 * (1 + sum(a * np.sin(k * th + f) for k, a, f in [(3, 0.06, 0.3), (5, 0.05, 1.1), (9, 0.04, 2.0), (17, 0.03, 0.7), (29, 0.02, 2.9)]))
    corpo = np.clip((raggio - r) / 6, 0, 1)
    b = rng.random((N // 32, N // 32))
    b = np.asarray(Image.fromarray((b * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)).astype(float) / 255
    salva(corpo * (0.55 + 0.45 * np.clip((b - 0.18) * 4, 0, 1)), dest, "gessetto", tronca=True)  # come la Fetta 4

    # tonda-morbida: come un aerografo, piena al centro e sfumata al bordo.
    r = np.hypot(xx - cx, yy - cy) / 220
    t = np.clip(1 - r, 0, 1)
    salva(t * t * (3 - 2 * t), dest, "tonda-morbida")

    # pennino-a-punta: una mandorla stretta con le punte aguzze (il tratto
    # sottile/spesso lo fanno la rotazione e la pressione).
    m = Image.new("L", (N * 4, N * 4), 0)
    d = ImageDraw.Draw(m)
    pts = []
    for i in range(0, 361):
        a = np.deg2rad(i)
        x = 220 * np.cos(a)
        y = 34 * np.sign(np.sin(a)) * abs(np.sin(a)) ** 1.6  # fianchi tesi: punte aguzze
        pts.append((4 * (cx + x), 4 * (cy + y)))
    d.polygon(pts, fill=255)
    salva(np.asarray(m.resize((N, N), Image.LANCZOS)).astype(float) / 255, dest, "pennino-a-punta")


# ──────────────────────── ACQUERELLO ────────────────────────
def acquerello(dest):
    r0 = np.hypot(xx - cx, yy - cy)
    th = np.arctan2(yy - cy, xx - cx)

    def macchia(rng, raggio, morbido, ampiezze):
        bordo_r = raggio * (1 + sum(a * np.sin(k * th + rng.random() * 6.28) for k, a in ampiezze))
        return np.clip((bordo_r - r0) / morbido, 0, 1)

    # watercolor-stamp — la punta di BASE, tarata sulla base di prima: stesso
    # massimo (0,22) e stessa quantità di colore (somma delle alfa ~7 800),
    # così l'acquerello «di partenza» resta scuro e largo uguale.
    rng = np.random.default_rng(101)
    corpo = macchia(rng, 240, 260, [(3, 0.05), (5, 0.04), (8, 0.03), (13, 0.02)])
    base = corpo ** 1.5 * (0.55 + 0.45 * fbm(rng))
    salva(base / base.max() * 0.22, dest, "watercolor-stamp")

    # tonda-morbida: piena e morbida, un po' più carica della base.
    rng = np.random.default_rng(102)
    corpo = macchia(rng, 190, 90, [(4, 0.03), (7, 0.02)])
    salva(corpo ** 1.6 * (0.7 + 0.3 * fbm(rng)) * 0.34, dest, "tonda-morbida")

    # bordo-bagnato: il pigmento si ferma sui due BORDI del tratto. Il
    # profilo è di traverso (in verticale nella punta): l'acquerello gira la
    # punta lungo il tratto, e le due fasce scure diventano i due bordi. (Un
    # anello intorno alla punta farebbe una bolla per ogni timbro.)
    rng = np.random.default_rng(103)
    dy = np.abs(yy - cy) + 10 * (rumore(rng, 32) - 0.5)
    lati = np.clip((200 - dy) / 12, 0, 1)
    fascia = np.exp(-((dy - 176) / 20) ** 2)
    fx = np.clip((150 - abs(xx - cx)) / 130, 0, 1) ** 1.5
    salva(fx * lati * (0.05 + 0.03 * fbm(rng) + 0.24 * fascia), dest, "bordo-bagnato")

    # bordo-sfumato: scuro da un lato del tratto, sfuma verso l'altro.
    rng = np.random.default_rng(111)
    t = np.clip((yy - (cy - 200)) / 400, 0, 1)  # 0 in alto, 1 in basso
    lati = np.clip((200 - np.abs(yy - cy) + 8 * (rumore(rng, 32) - 0.5)) / 12, 0, 1)
    fx = np.clip((150 - abs(xx - cx)) / 130, 0, 1) ** 1.5
    salva(fx * lati * (0.02 + 0.30 * (1 - t) ** 1.8) * (0.85 + 0.15 * fbm(rng)), dest, "bordo-sfumato")

    # nuvola: macchia morbida e irregolare, a nuvola.
    rng = np.random.default_rng(104)
    f = fbm(rng, (256, 128, 64, 32, 16), (0.35, 0.3, 0.18, 0.11, 0.06))
    corpo = np.clip((1 - r0 / 230), 0, 1) ** 0.8
    salva(np.clip((f * corpo - 0.18) * 1.6, 0, 1) * 0.26, dest, "nuvola")

    # granulazione: il pigmento che si deposita a grani.
    rng = np.random.default_rng(105)
    corpo = macchia(rng, 185, 70, [(3, 0.05), (7, 0.03)])
    grani = rng.random((N, N))
    grani = sfoca(grani, 1.4)
    grani = np.clip((grani - 0.48) * 6, 0, 1)
    salva(corpo * (0.04 + 0.32 * grani * (0.6 + 0.4 * fbm(rng))), dest, "granulazione")

    # spugna: tamponato, a buchi.
    rng = np.random.default_rng(106)
    corpo = macchia(rng, 190, 40, [(3, 0.06), (5, 0.05), (9, 0.03)])
    buchi = np.clip((fbm(rng, (32, 16, 8, 4), (0.4, 0.3, 0.2, 0.1)) - 0.36) * 2.4, 0, 1)
    salva(corpo * (0.25 + 0.75 * buchi) * 0.26, dest, "spugna")

    # schizzi: gocce di varie misure intorno a un centro.
    rng = np.random.default_rng(107)
    m = Image.new("L", (N * 2, N * 2), 0)
    d = ImageDraw.Draw(m)
    for _ in range(140):
        rr = abs(rng.normal(0, 120))
        a = rng.random() * 6.283
        s = max(2, (rng.pareto(2.2) + 0.6) * 5 * (1.3 - rr / 260))
        x, y = cx + rr * np.cos(a), cy + rr * np.sin(a)
        if rr + s > 240:
            continue
        g = int(110 + rng.random() * 145)
        d.ellipse([2 * (x - s), 2 * (y - s), 2 * (x + s), 2 * (y + s)], fill=g)
    a = np.asarray(m.resize((N, N), Image.LANCZOS)).astype(float) / 255
    salva(sfoca(a, 0.8) * 0.55, dest, "schizzi")

    # Le punte piatte: parte larga in VERTICALE, setole in orizzontale
    # (lungo il tratto: le righe diventano le strisce delle setole).
    def setole(rng, h):
        righe = rng.random(N)
        righe = np.asarray(Image.fromarray((righe * 255).astype(np.uint8).reshape(-1, 1)).filter(ImageFilter.GaussianBlur(1.2))).astype(float)[:, 0] / 255
        righe = np.clip(0.35 + (righe - 0.5) * 1.8, 0.05, 1)
        return np.repeat(righe.reshape(-1, 1), N, axis=1)

    # piatta: rettangolo alto e stretto, bordi un po' sfilacciati.
    rng = np.random.default_rng(108)
    semi_w, semi_h = 115, 215
    fx = np.clip((semi_w - abs(xx - cx)) / 80, 0, 1) ** 1.5  # lati sfumati lungo il tratto: niente «scala a pioli»
    fy = np.clip((semi_h + 12 * (rumore(rng, 16) - 0.5) - abs(yy - cy)) / 14, 0, 1)
    salva(fx * fy * setole(rng, semi_h) * (0.75 + 0.25 * fbm(rng)) * 0.34, dest, "piatta")

    # lingua-di-gatto (filbert): ovale alto, setole, bordo morbido.
    rng = np.random.default_rng(109)
    ov = np.hypot((xx - cx) / 125, (yy - cy) / 210)
    corpo = np.clip((1 - ov) / 0.45, 0, 1) ** 1.3
    salva(corpo * setole(rng, 210) * (0.75 + 0.25 * fbm(rng)) * 0.34, dest, "lingua-di-gatto")

    # tonda-asciutta: pennello quasi scarico, la carta che «salta».
    rng = np.random.default_rng(110)
    corpo = macchia(rng, 180, 30, [(4, 0.05), (7, 0.04), (12, 0.03)])
    secco = np.clip((setole(rng, 180) * (0.6 + 0.4 * rumore(rng, 6, 0.6)) - 0.28) * 2.2, 0, 1)
    salva(corpo * secco * 0.36, dest, "tonda-asciutta")


if __name__ == "__main__":
    radice = sys.argv[1] if len(sys.argv) > 1 else RADICE
    penna(os.path.join(radice, "app", "textures", "penna"))
    acquerello(os.path.join(radice, "app", "textures", "brush"))
    print("Punte scritte in", os.path.join(radice, "app", "textures"))
