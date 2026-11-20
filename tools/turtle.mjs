// Streckenbau aus Geraden und Kreisbögen ("Schildkröte").
// cmds: ['S', länge, y?] | ['T', winkelGrad (+ = gegen Uhrzeigersinn in x/z), radius, y?]
// Liefert Kontrollpunkte [x, z, y] alle ~step Meter; Schließfehler wird verteilt.
export function turtle(start, heading, cmds, step = 12) {
  let x = start[0], z = start[1], h = (heading * Math.PI) / 180, y = start[2] || 0;
  const pts = [[x, z, y]];
  for (const c of cmds) {
    const y0 = y, y1 = c[0] === 'S' ? (c[2] ?? y) : (c[3] ?? y);
    if (c[0] === 'S') {
      const n = Math.max(1, Math.round(c[1] / step));
      for (let k = 1; k <= n; k++) { const t = k / n; pts.push([x + Math.cos(h) * c[1] * t, z + Math.sin(h) * c[1] * t, y0 + (y1 - y0) * t]); }
      x += Math.cos(h) * c[1]; z += Math.sin(h) * c[1];
    } else {
      const ang = (c[1] * Math.PI) / 180, r = c[2], s = Math.sign(ang);
      const cx = x - Math.sin(h) * r * s, cz = z + Math.cos(h) * r * s;
      const a0 = Math.atan2(z - cz, x - cx);
      const n = Math.max(2, Math.round((Math.abs(ang) * r) / step));
      for (let k = 1; k <= n; k++) { const t = k / n, a = a0 + ang * t; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, y0 + (y1 - y0) * t]); }
      x = cx + Math.cos(a0 + ang) * r; z = cz + Math.sin(a0 + ang) * r; h += ang;
    }
    y = y1;
  }
  const last = pts.pop();
  const ex = last[0] - pts[0][0], ez = last[1] - pts[0][1];
  const n = pts.length;
  const out = pts.map((p, i) => [Math.round((p[0] - (ex * i) / n) * 10) / 10, Math.round((p[1] - (ez * i) / n) * 10) / 10, Math.round(p[2] * 100) / 100]);
  out.closeErr = Math.hypot(ex, ez);
  out.headErr = ((((h * 180) / Math.PI - heading) % 360) + 540) % 360 - 180;
  return out;
}
