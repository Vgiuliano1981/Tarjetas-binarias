'use strict';
/* PunchCard Messenger — todo se ejecuta localmente en el navegador.
   Formato de tarjeta (A4 horizontal):
   - Cuadrícula de W x H celdas de 3 mm. Cuatro marcadores sólidos de 5x5 celdas en las esquinas.
   - Zona de datos: filas R0..R0+ROWS-1, 1 bit por celda (cuadrado negro = 1), bits MSB primero.
   - Bytes: A5 5A | versión | longitud(2) | datos UTF-8 | CRC32(4) | 5A A5 | relleno. Todo "blanqueado" con XOR pseudoaleatorio. */

const W = 88, H = 60, P = 3, MX = 16.5, MY = 15;   // cuadrícula, paso (mm), márgenes (mm)
const R0 = 6, ROWS = 48;                            // zona de datos
const CAPB = W * ROWS / 8, OVER = 11, MAXB = CAPB - OVER, VER = 1;
const $ = id => document.getElementById(id);

/* ---------- CRC32 y blanqueado ---------- */
const CT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = -1; for (const x of b) c = CT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
function whiten(b) { let s = 0x1BADF00D; for (let i = 0; i < b.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; b[i] ^= s & 255; } return b; }

/* ---------- Codificación: texto -> bytes de la tarjeta ---------- */
function encode(text) {
  const d = new TextEncoder().encode(text);
  if (d.length > MAXB) return null;
  const b = new Uint8Array(CAPB);
  b.set([0xA5, 0x5A, VER, d.length >> 8, d.length & 255]); b.set(d, 5);
  const e = 5 + d.length, c = crc32(b.subarray(2, e));
  b.set([c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255, 0x5A, 0xA5], e);
  return whiten(b);
}

/* ---------- Decodificación: bytes leídos -> texto (valida inicio, versión, longitud, CRC, final) ---------- */
function parse(raw) {
  const b = whiten(raw.slice()), r = { magic: b[0] === 0xA5 && b[1] === 0x5A, len: (b[3] << 8) | b[4], bytes: b };
  const fail = m => (r.err = m, r);
  if (!r.magic) return fail('Marcador de inicio no encontrado');
  if (b[2] !== VER) return fail('Versión desconocida');
  if (r.len > MAXB) return fail('Longitud inválida');
  const e = 5 + r.len;
  r.exp = ((b[e] << 24) | (b[e + 1] << 16) | (b[e + 2] << 8) | b[e + 3]) >>> 0;
  r.got = crc32(b.subarray(2, e));
  if (r.exp !== r.got) return fail('CRC incorrecto');
  if (b[e + 4] !== 0x5A || b[e + 5] !== 0xA5) return fail('Marcador de final no encontrado');
  try { r.text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(5, e)); } catch { return fail('UTF-8 inválido'); }
  r.ok = true; return r;
}

/* ---------- Dibujo de la tarjeta (S = píxeles por mm) ---------- */
function drawCard(cv, S, buf) {
  cv.width = Math.round(297 * S); cv.height = Math.round(210 * S);
  const x = cv.getContext('2d'), p = P * S, gx = MX * S, gy = MY * S;
  x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
  x.fillStyle = x.strokeStyle = '#000';
  x.lineWidth = .6 * S; x.strokeRect(gx - 1.5 * p, gy - 1.5 * p, (W + 3) * p, (H + 3) * p);   // borde exterior
  for (const [c, r] of [[0, 0], [W - 5, 0], [0, H - 5], [W - 5, H - 5]]) x.fillRect(gx + c * p, gy + r * p, 5 * p, 5 * p); // marcadores
  x.textBaseline = 'middle';
  x.font = `bold ${7 * S}px "Courier New",monospace`; x.fillText('PUNCHCARD', gx + 7 * p, gy + 2.5 * p);
  x.font = `${3 * S}px "Courier New",monospace`; x.textAlign = 'right';
  x.fillText(`v${VER} / UTF-8 / CRC32`, gx + (W - 7) * p, gy + 2.5 * p);
  x.textAlign = 'left'; x.fillText(`PC-${VER}  ${W}x${ROWS} bits  ${CAPB} bytes`, gx + 7 * p, gy + (H - 2.5) * p);
  for (let i = 0; i < W * ROWS; i++)                                                           // bits
    if ((buf[i >> 3] >> (7 - (i & 7))) & 1) x.fillRect(gx + ((i % W) + .15) * p, gy + (R0 + ((i / W) | 0) + .15) * p, .7 * p, .7 * p);
}

/* ---------- Geometría: homografía (celdas -> píxeles) ---------- */
function homog(d, s) {
  const A = [];
  for (let i = 0; i < 4; i++) { const [u, v] = d[i], { x, y } = s[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x], [0, 0, 0, u, v, 1, -u * y, -v * y, y]); }
  for (let c = 0; c < 8; c++) {
    let m = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
    [A[c], A[m]] = [A[m], A[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j < 9; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((r, i) => r[8] / r[i]);
}
const map = (T, u, v) => { const z = T[6] * u + T[7] * v + 1; return [(T[0] * u + T[1] * v + T[2]) / z, (T[3] * u + T[4] * v + T[5]) / z]; };

/* Muestrea cada celda de datos (9 puntos, voto por mayoría) sobre la imagen binarizada */
function sample(T, bin, w, h) {
  const out = new Uint8Array(CAPB); let dots = 0, bits = '';
  for (let i = 0; i < W * ROWS; i++) {
    const c = i % W, r = R0 + ((i / W) | 0); let v = 0;
    for (let dy = -1; dy < 2; dy++) for (let dx = -1; dx < 2; dx++) {
      const [x, y] = map(T, c + .5 + dx * .22, r + .5 + dy * .22), X = Math.round(x), Y = Math.round(y);
      if (X >= 0 && Y >= 0 && X < w && Y < h) v += bin[Y * w + X];
    }
    if (v >= 5) { out[i >> 3] |= 128 >> (i & 7); dots++; }
    if (i < 256) bits += v >= 5 ? 1 : 0;
  }
  return { out, dots, bits };
}

/* ---------- Lectura: imagen -> mensaje ---------- */
function analyze(img) {
  // 1-2. Reducir tamaño y pasar a escala de grises
  const k = Math.min(1, 1500 / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
  const cv = $('src'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
  const px = cx.getImageData(0, 0, w, h).data, n = w * h, g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = .299 * px[4 * i] + .587 * px[4 * i + 1] + .114 * px[4 * i + 2];
  // 3. Umbral adaptativo (imagen integral): tolera sombras e iluminación despareja
  const iw = w + 1, I = new Float64Array(iw * (h + 1)), rad = Math.max(12, Math.round(Math.max(w, h) / 12)), bin = new Uint8Array(n);
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += g[y * w + x]; I[(y + 1) * iw + x + 1] = I[y * iw + x + 1] + s; } }
  for (let y = 0; y < h; y++) { const y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
    for (let x = 0; x < w; x++) { const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1);
      const m = (I[y1 * iw + x1] - I[y0 * iw + x1] - I[y1 * iw + x0] + I[y0 * iw + x0]) / ((x1 - x0) * (y1 - y0));
      bin[y * w + x] = g[y * w + x] < m * .8 ? 1 : 0; } }
  // 4. Buscar marcadores: componentes oscuros casi cuadrados y rellenos (invariante a rotación)
  const seen = new Uint8Array(n), st = new Int32Array(n), cand = [];
  for (let s = 0; s < n; s++) {
    if (!bin[s] || seen[s]) continue;
    let sp = 0, a = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0; st[sp++] = s; seen[s] = 1;
    while (sp) {
      const q = st[--sp], qx = q % w, qy = (q / w) | 0; a++; sx += qx; sy += qy;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      if (qx > 0 && bin[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; st[sp++] = q - 1; }
      if (qx < w - 1 && bin[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; st[sp++] = q + 1; }
      if (qy > 0 && bin[q - w] && !seen[q - w]) { seen[q - w] = 1; st[sp++] = q - w; }
      if (qy < h - 1 && bin[q + w] && !seen[q + w]) { seen[q + w] = 1; st[sp++] = q + w; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, ar = bw / bh;
    if (a > n * 4e-4 && ar > .7 && ar < 1.43 && a / (bw * bh) > .45) cand.push({ a, x: sx / a, y: sy / a });
  }
  cand.sort((p, q) => q.a - p.a);
  const M = cand.slice(0, 4), dbg = [`Marcadores candidatos: ${cand.length}`];
  if (M.length < 4) return show(null, dbg, 'No se encontraron los 4 marcadores de esquina');
  for (const m of M) { cx.strokeStyle = '#39ff7a'; cx.lineWidth = 3; cx.beginPath(); cx.arc(m.x, m.y, 14, 0, 7); cx.stroke(); }
  // Ordenar en sentido horario; probar las 4 rotaciones posibles (la tarjeta puede estar girada)
  const mx = M.reduce((s, m) => s + m.x, 0) / 4, my = M.reduce((s, m) => s + m.y, 0) / 4;
  M.sort((p, q) => Math.atan2(p.y - my, p.x - mx) - Math.atan2(q.y - my, q.x - mx));
  const dst = [[2.5, 2.5], [W - 2.5, 2.5], [W - 2.5, H - 2.5], [2.5, H - 2.5]];
  let best = null;
  for (let r = 0; r < 4; r++) {
    // 5-6. Perspectiva + cuadrícula: muestreo directo de cada celda
    const T = homog(dst, [0, 1, 2, 3].map(i => M[(i + r) % 4])), s = sample(T, bin, w, h);
    const res = parse(s.out); Object.assign(res, { rot: r, dots: s.dots, bits: s.bits, raw: s.out });
    if (res.ok) { best = res; break; }
    if (!best || (res.magic && !best.magic)) best = res;
  }
  show(best, dbg);
}

function show(r, dbg, why) {
  const st = $('status'), out = $('out');
  if (r && r.ok) {
    st.className = 'status ok'; st.textContent = '✓ Tarjeta leída correctamente';
    out.textContent = r.text; out.hidden = false;
  } else {
    st.className = 'status err';
    st.textContent = '⚠️ No se pudo leer correctamente la tarjeta. Intenta tomar una foto con mejor iluminación y que incluya toda la tarjeta.';
    out.hidden = true;
  }
  const hex = r ? [...r.bytes.slice(0, 48)].map(b => b.toString(16).padStart(2, '0')).join(' ') : '-';
  dbg.push(`Estado: ${r && r.ok ? 'OK' : (why || r.err)}`);
  if (r) dbg.push(`Rotación probada: ${r.rot * 90}°`, `Puntos detectados: ${r.dots}`, `Longitud declarada: ${r.len} bytes`,
    `CRC leído: ${r.exp !== undefined ? r.exp.toString(16) : '-'} | calculado: ${r.got !== undefined ? r.got.toString(16) : '-'}`,
    `Bits (primeros 256): ${r.bits}`, `Bytes (primeros 48, ya desblanqueados): ${hex}`);
  $('debug').textContent = dbg.join('\n');
  scan($('srcWrap'));
}

/* ---------- Interfaz ---------- */
const scan = el => { el.classList.remove('run'); void el.offsetWidth; el.classList.add('run'); };
let buf = null;

function refresh() {
  const t = $('msg').value, nb = new TextEncoder().encode(t).length;
  $('count').textContent = `${[...t].length} caracteres`;
  $('cap').textContent = `${nb}/${MAXB} bytes`; $('cap').className = nb > MAXB ? 'bad' : '';
  buf = nb > MAXB ? null : encode(t);
  if (buf) drawCard($('preview'), 4, buf);
  for (const id of ['gen', 'prt', 'pdf', 'png']) $(id).disabled = !buf || !t;
}
const big = S => { const c = document.createElement('canvas'); drawCard(c, S, buf); return c; };

$('msg').oninput = refresh;
$('gen').onclick = () => { refresh(); scan($('cardWrap')); };
$('ex').onclick = () => { $('msg').value = 'Hola desde 1960 👋\nEste mensaje viajó en una tarjeta perforada: texto → bits → papel → foto → texto.'; refresh(); scan($('cardWrap')); };
$('png').onclick = () => { const a = document.createElement('a'); a.href = big(10).toDataURL('image/png'); a.download = 'punchcard.png'; a.click(); };
$('pdf').onclick = () => {
  if (!window.jspdf) return alert('No se pudo cargar jsPDF (¿sin conexión?). Usa PNG o Imprimir.');
  const d = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  d.addImage(big(8).toDataURL('image/png'), 'PNG', 0, 0, 297, 210); d.save('punchcard.pdf');
};
$('prt').onclick = () => {
  const im = $('printImg'), u = big(8).toDataURL('image/png');
  if (im.src === u) window.print(); else { im.onload = () => window.print(); im.src = u; }
};

function load(f) {
  if (!f) return;
  const url = URL.createObjectURL(f), im = new Image();
  im.onload = () => { URL.revokeObjectURL(url); analyze(im); };
  im.onerror = () => show(null, [], 'No se pudo abrir la imagen');
  im.src = url;
}
$('file').onchange = e => load(e.target.files[0]);
$('cam').onchange = e => load(e.target.files[0]);
const dz = $('drop');
['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e => load(e.dataTransfer.files[0]));
$('dbg').onchange = e => { $('debug').hidden = !e.target.checked; };

function tab(c) { $('create').hidden = !c; $('read').hidden = c; $('tabC').classList.toggle('on', c); $('tabL').classList.toggle('on', !c); }
$('tabC').onclick = () => tab(true); $('tabL').onclick = () => tab(false);

$('msg').value = 'Hola mundo'; refresh();
