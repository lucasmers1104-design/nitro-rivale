import json, sys
from PIL import Image, ImageDraw, ImageFont
d = json.load(open('/tmp/tracks.json'))
ids = list(d.keys())
S = 560
img = Image.new('RGB', (S * len(ids), S + 30), (24, 26, 32))
dr = ImageDraw.Draw(img)
for k, tid in enumerate(ids):
    pts, rad = d[tid]['pts'], d[tid]['rad']
    ox = k * S
    sc = (S - 40) / 680
    P = lambda x, z: (ox + S / 2 + x * sc, 15 + S / 2 + z * sc)
    dr.rectangle([P(-330, -330), P(330, 330)], outline=(70, 70, 80))
    ys = [p[2] for p in pts]; y0, y1 = min(ys), max(ys)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        r = rad[i]
        col = (230, 60, 50) if r < 30 else (240, 160, 40) if r < 60 else (230, 220, 80) if r < 120 else (120, 200, 120)
        dr.line([P(a[0], a[1]), P(b[0], b[1])], fill=col, width=max(2, int(14 * sc)))
    for i in range(0, len(pts), 42):
        x, z = P(pts[i][0], pts[i][1])
        dr.text((x + 4, z - 12), f"{int(i*2.4)}m y{pts[i][2]:.0f}", fill=(220, 220, 230))
    x, z = P(pts[0][0], pts[0][1]); dr.ellipse([x - 6, z - 6, x + 6, z + 6], fill=(255, 255, 255))
    x2, z2 = P(pts[3][0], pts[3][1]); dr.line([x, z, x2, z2], fill=(0, 200, 255), width=4)
    dr.text((ox + 10, S + 8), f"{tid}  y {y0:.0f}..{y1:.0f}", fill=(255, 255, 255))
img.save(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/racer/shots/tracks.png')
