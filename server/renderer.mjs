import { deflateSync, crc32 } from 'node:zlib';

const NAMED_COLORS = {
  transparent: [0, 0, 0, 0],
  none: [0, 0, 0, 0],
  black: [0, 0, 0, 255],
  white: [255, 255, 255, 255],
  red: [239, 68, 68, 255],
  green: [34, 197, 94, 255],
  blue: [59, 130, 246, 255],
  yellow: [234, 179, 8, 255],
  cyan: [6, 182, 212, 255],
  magenta: [217, 70, 239, 255],
  orange: [249, 115, 22, 255],
  purple: [168, 85, 247, 255],
  pink: [236, 72, 153, 255],
  gray: [148, 163, 184, 255],
  grey: [148, 163, 184, 255],
};

export function parseColor(input, defaultAlpha = 255) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (NAMED_COLORS[s]) return [...NAMED_COLORS[s]];
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : defaultAlpha;
      return [r, g, b, a];
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : defaultAlpha;
      return [r, g, b, a];
    }
  }
  const rgbMatch = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (rgbMatch) {
    return [
      Math.max(0, Math.min(255, Math.round(Number(rgbMatch[1])))),
      Math.max(0, Math.min(255, Math.round(Number(rgbMatch[2])))),
      Math.max(0, Math.min(255, Math.round(Number(rgbMatch[3])))),
      rgbMatch[4] !== undefined ? Math.max(0, Math.min(255, Math.round(Number(rgbMatch[4]) * 255))) : 255,
    ];
  }
  return null;
}

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveBgColor(background, theme = 'dark') {
  if (!background || background === 'auto') {
    return theme === 'light' ? '#f5f7fb' : '#0b1020';
  }
  if (background === 'dark') return '#0b1020';
  if (background === 'light') return '#f5f7fb';
  if (background === 'transparent') return 'transparent';
  return background;
}

function smoothSvgPathFromPoints(pts, closed = false) {
  if (!pts || pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y} L ${pts[0].x + 0.1} ${pts[0].y + 0.1}`;
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}${closed ? ' Z' : ''}`;
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i].x + pts[i + 1].x) / 2).toFixed(2);
    const my = ((pts[i].y + pts[i + 1].y) / 2).toFixed(2);
    d += ` Q ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  if (closed) d += ' Z';
  return d;
}

export function boardToSvg(board, { theme = 'dark', includeBackground = true } = {}) {
  const w = board.width || 1200;
  const h = board.height || 800;
  const bg = resolveBgColor(board.background, theme);
  const layersById = new Map((board.layers || []).map((l) => [l.id, l]));
  const defs = [];
  const parts = [];

  if (includeBackground && bg !== 'transparent') {
    parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${escapeXml(bg)}" />`);
  }

  let gradIdx = 0;
  for (const el of board.elements || []) {
    if (el.visible === false) continue;
    const layer = layersById.get(el.layerId);
    if (layer && layer.visible === false) continue;
    const opacity = (el.opacity ?? 1) * (layer?.opacity ?? 1);
    if (opacity <= 0) continue;

    let fillAttr = el.fill && el.fill !== 'none' ? escapeXml(el.fill) : 'none';
    if (el.fillGradient && Array.isArray(el.fillGradient.stops) && el.fillGradient.stops.length >= 2) {
      const gid = `lg_${gradIdx++}`;
      const angle = ((el.fillGradient.angle ?? 135) * Math.PI) / 180;
      const x1 = (50 - Math.cos(angle) * 50).toFixed(1);
      const y1 = (50 - Math.sin(angle) * 50).toFixed(1);
      const x2 = (50 + Math.cos(angle) * 50).toFixed(1);
      const y2 = (50 + Math.sin(angle) * 50).toFixed(1);
      const stops = el.fillGradient.stops
        .map((s) => `<stop offset="${Math.round((s.offset ?? 0) * 100)}%" stop-color="${escapeXml(s.color)}" />`)
        .join('');
      defs.push(`<linearGradient id="${gid}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stops}</linearGradient>`);
      fillAttr = `url(#${gid})`;
    }

    const strokeAttr = el.stroke && el.stroke !== 'none' ? escapeXml(el.stroke) : 'none';
    const sw = el.strokeWidth ?? 2;
    const dashAttr = Array.isArray(el.dash) && el.dash.length ? ` stroke-dasharray="${el.dash.join(' ')}"` : '';
    const opAttr = opacity < 0.999 ? ` opacity="${opacity.toFixed(3)}"` : '';

    let node = '';
    if (el.type === 'rect') {
      const r = el.radius || 0;
      node = `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${r}" ry="${r}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${sw}"${dashAttr}${opAttr} />`;
    } else if (el.type === 'ellipse') {
      node = `<ellipse cx="${el.cx}" cy="${el.cy}" rx="${el.rx}" ry="${el.ry}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${sw}"${dashAttr}${opAttr} />`;
    } else if (el.type === 'freehand') {
      const d = el.smooth !== false
        ? smoothSvgPathFromPoints(el.points, false)
        : (el.points || []).map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      if (d) {
        node = `<path d="${d}" fill="none" stroke="${strokeAttr}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${opAttr} />`;
      }
    } else if (el.type === 'polygon') {
      const pts = el.points || [];
      if (pts.length) {
        const d = el.smooth
          ? smoothSvgPathFromPoints(pts, el.closed !== false)
          : pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (el.closed !== false ? ' Z' : '');
        node = `<path d="${d}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}${opAttr} />`;
      }
    } else if (el.type === 'path') {
      const tr = `translate(${el.x || 0} ${el.y || 0}) scale(${el.scaleX ?? 1} ${el.scaleY ?? 1})`;
      node = `<path d="${escapeXml(el.d)}" transform="${tr}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}${opAttr} />`;
    } else if (el.type === 'line' || el.type === 'arrow') {
      const d = el.cx !== undefined && el.cy !== undefined
        ? `M ${el.x1} ${el.y1} Q ${el.cx} ${el.cy} ${el.x2} ${el.y2}`
        : `M ${el.x1} ${el.y1} L ${el.x2} ${el.y2}`;
      const sub = [`<path d="${d}" fill="none" stroke="${strokeAttr}" stroke-width="${sw}" stroke-linecap="round"${dashAttr} />`];
      if (el.endArrow === 'arrow') {
        const ax = el.cx !== undefined ? el.cx : el.x1;
        const ay = el.cy !== undefined ? el.cy : el.y1;
        const ang = Math.atan2(el.y2 - ay, el.x2 - ax);
        const head = Math.max(10, sw * 3.6);
        const p1x = (el.x2 - head * Math.cos(ang - 0.45)).toFixed(2);
        const p1y = (el.y2 - head * Math.sin(ang - 0.45)).toFixed(2);
        const p2x = (el.x2 - head * Math.cos(ang + 0.45)).toFixed(2);
        const p2y = (el.y2 - head * Math.sin(ang + 0.45)).toFixed(2);
        sub.push(`<path d="M ${p1x} ${p1y} L ${el.x2} ${el.y2} L ${p2x} ${p2y}" fill="none" stroke="${strokeAttr}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" />`);
      }
      if (el.label) {
        const mx = el.cx !== undefined ? (el.x1 + 2 * el.cx + el.x2) / 4 : (el.x1 + el.x2) / 2;
        const my = el.cy !== undefined ? (el.y1 + 2 * el.cy + el.y2) / 4 : (el.y1 + el.y2) / 2;
        sub.push(`<text x="${mx}" y="${my - 6}" text-anchor="middle" fill="${strokeAttr}" font-size="13" font-family="sans-serif">${escapeXml(el.label)}</text>`);
      }
      node = `<g${opAttr}>${sub.join('')}</g>`;
    } else if (el.type === 'text') {
      const lines = String(el.text || '').split(/\r?\n/);
      const fs = el.fontSize || 20;
      const anchor = el.align === 'center' ? 'middle' : (el.align === 'right' ? 'end' : 'start');
      const tspans = lines
        .map((line, i) => `<tspan x="${el.x}" dy="${i === 0 ? fs : fs * 1.35}">${escapeXml(line || ' ')}</tspan>`)
        .join('');
      node = `<text x="${el.x}" y="${el.y}" text-anchor="${anchor}" fill="${escapeXml(el.color || '#e2e8f0')}" font-size="${fs}" font-weight="${escapeXml(el.fontWeight || '500')}" font-family="${escapeXml(el.fontFamily || 'sans-serif')}"${opAttr}>${tspans}</text>`;
    } else if (el.type === 'image' && el.src) {
      node = `<image href="${escapeXml(el.src)}" x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" preserveAspectRatio="none"${opAttr} />`;
    }

    if (node) parts.push(node);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    defs.length ? `<defs>${defs.join('')}</defs>` : '',
    ...parts,
    '</svg>',
  ].filter(Boolean).join('\n');
}

// Pure-Node PNG encoding & rasterizer fallback (used when browser canvas hasn't pushed a snapshot yet)
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(crcInput) >>> 0, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function encodeRgbaPng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.allocUnsafe(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    raw[rowOff] = 0; // filter None
    rgba.copy(raw, rowOff + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function blendPixel(buf, w, h, x, y, r, g, b, a) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= w || iy >= h || a <= 0) return;
  const idx = (iy * w + ix) * 4;
  const sa = a / 255;
  const da = buf[idx + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  buf[idx] = Math.round((r * sa + buf[idx] * da * (1 - sa)) / outA);
  buf[idx + 1] = Math.round((g * sa + buf[idx + 1] * da * (1 - sa)) / outA);
  buf[idx + 2] = Math.round((b * sa + buf[idx + 2] * da * (1 - sa)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function fillDisk(buf, w, h, cx, cy, radius, rgba) {
  const [r, g, b, a] = rgba;
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(w - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(h - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        blendPixel(buf, w, h, x, y, r, g, b, a);
      }
    }
  }
}

function drawSegment(buf, w, h, x1, y1, x2, y2, thickness, rgba) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(dist * 1.5));
  const rad = Math.max(0.7, thickness / 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillDisk(buf, w, h, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, rad, rgba);
  }
}

function drawRoundedRect(buf, w, h, x, y, rw, rh, rad, fillRgba, strokeRgba, sw) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(w - 1, Math.ceil(x + rw));
  const y1 = Math.min(h - 1, Math.ceil(y + rh));
  const r = Math.min(rad, rw / 2, rh / 2);

  if (fillRgba && fillRgba[3] > 0) {
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        let inside = true;
        if (r > 0) {
          const cx = px < x + r ? x + r : (px > x + rw - r ? x + rw - r : px);
          const cy = py < y + r ? y + r : (py > y + rh - r ? y + rh - r : py);
          if ((px - cx) ** 2 + (py - cy) ** 2 > r * r) inside = false;
        }
        if (inside) blendPixel(buf, w, h, px, py, fillRgba[0], fillRgba[1], fillRgba[2], fillRgba[3]);
      }
    }
  }

  if (strokeRgba && strokeRgba[3] > 0 && sw > 0) {
    drawSegment(buf, w, h, x + r, y, x + rw - r, y, sw, strokeRgba);
    drawSegment(buf, w, h, x + rw, y + r, x + rw, y + rh - r, sw, strokeRgba);
    drawSegment(buf, w, h, x + rw - r, y + rh, x + r, y + rh, sw, strokeRgba);
    drawSegment(buf, w, h, x, y + rh - r, x, y + r, sw, strokeRgba);
  }
}

function drawEllipse(buf, w, h, cx, cy, rx, ry, fillRgba, strokeRgba, sw) {
  const minX = Math.max(0, Math.floor(cx - rx - sw));
  const maxX = Math.min(w - 1, Math.ceil(cx + rx + sw));
  const minY = Math.max(0, Math.floor(cy - ry - sw));
  const maxY = Math.min(h - 1, Math.ceil(cy + ry + sw));
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const nx = (px - cx) / rx;
      const ny = (py - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d <= 1 && fillRgba && fillRgba[3] > 0) {
        blendPixel(buf, w, h, px, py, fillRgba[0], fillRgba[1], fillRgba[2], fillRgba[3]);
      }
    }
  }
  if (strokeRgba && strokeRgba[3] > 0 && sw > 0) {
    const segs = Math.max(24, Math.round((rx + ry) * 0.8));
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      drawSegment(buf, w, h, cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, sw, strokeRgba);
    }
  }
}

export function renderFallbackPng(board, { maxWidth = 900, theme = 'dark' } = {}) {
  const bw = board.width || 1200;
  const bh = board.height || 800;
  const scale = bw > maxWidth ? maxWidth / bw : 1;
  const w = Math.max(1, Math.round(bw * scale));
  const h = Math.max(1, Math.round(bh * scale));
  const buf = Buffer.alloc(w * h * 4);

  const bgStr = resolveBgColor(board.background, theme);
  const bgRgba = bgStr === 'transparent' ? [15, 23, 42, 0] : (parseColor(bgStr) || [11, 16, 32, 255]);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = bgRgba[0];
    buf[i * 4 + 1] = bgRgba[1];
    buf[i * 4 + 2] = bgRgba[2];
    buf[i * 4 + 3] = bgRgba[3];
  }

  if (board.showGrid !== false) {
    const dot = theme === 'light' ? [148, 163, 184, 55] : [148, 163, 184, 40];
    const step = 32 * scale;
    for (let y = step; y < h; y += step) {
      for (let x = step; x < w; x += step) {
        blendPixel(buf, w, h, x, y, dot[0], dot[1], dot[2], dot[3]);
      }
    }
  }

  const layersById = new Map((board.layers || []).map((l) => [l.id, l]));
  const applyOp = (rgba, op) => (rgba ? [rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * op)] : null);

  for (const el of board.elements || []) {
    if (el.visible === false) continue;
    const layer = layersById.get(el.layerId);
    if (layer && layer.visible === false) continue;
    const op = (el.opacity ?? 1) * (layer?.opacity ?? 1);
    if (op <= 0) continue;

    let fillColor = el.fill && el.fill !== 'none' ? parseColor(el.fill) : null;
    if (!fillColor && el.fillGradient?.stops?.[0]?.color) {
      fillColor = parseColor(el.fillGradient.stops[0].color);
    }
    const strokeColor = el.stroke && el.stroke !== 'none' ? parseColor(el.stroke) : null;
    const sw = Math.max(1, (el.strokeWidth ?? 2) * scale);

    if (el.type === 'rect') {
      drawRoundedRect(
        buf, w, h,
        el.x * scale, el.y * scale, el.w * scale, el.h * scale, (el.radius || 0) * scale,
        applyOp(fillColor, op), applyOp(strokeColor, op), sw,
      );
    } else if (el.type === 'ellipse') {
      drawEllipse(
        buf, w, h,
        el.cx * scale, el.cy * scale, el.rx * scale, el.ry * scale,
        applyOp(fillColor, op), applyOp(strokeColor, op), sw,
      );
    } else if (el.type === 'freehand' || el.type === 'polygon') {
      const pts = el.points || [];
      const sc = applyOp(strokeColor || [56, 189, 248, 255], op);
      for (let i = 1; i < pts.length; i++) {
        drawSegment(buf, w, h, pts[i - 1].x * scale, pts[i - 1].y * scale, pts[i].x * scale, pts[i].y * scale, sw, sc);
      }
      if (el.type === 'polygon' && el.closed !== false && pts.length > 2) {
        drawSegment(buf, w, h, pts[pts.length - 1].x * scale, pts[pts.length - 1].y * scale, pts[0].x * scale, pts[0].y * scale, sw, sc);
      }
    } else if (el.type === 'line' || el.type === 'arrow') {
      const sc = applyOp(strokeColor || [56, 189, 248, 255], op);
      if (el.cx !== undefined && el.cy !== undefined) {
        let px = el.x1 * scale, py = el.y1 * scale;
        for (let i = 1; i <= 20; i++) {
          const t = i / 20;
          const qx = ((1 - t) ** 2 * el.x1 + 2 * (1 - t) * t * el.cx + t ** 2 * el.x2) * scale;
          const qy = ((1 - t) ** 2 * el.y1 + 2 * (1 - t) * t * el.cy + t ** 2 * el.y2) * scale;
          drawSegment(buf, w, h, px, py, qx, qy, sw, sc);
          px = qx; py = qy;
        }
      } else {
        drawSegment(buf, w, h, el.x1 * scale, el.y1 * scale, el.x2 * scale, el.y2 * scale, sw, sc);
      }
      if (el.endArrow === 'arrow') {
        const ax = (el.cx !== undefined ? el.cx : el.x1) * scale;
        const ay = (el.cy !== undefined ? el.cy : el.y1) * scale;
        const ex = el.x2 * scale, ey = el.y2 * scale;
        const ang = Math.atan2(ey - ay, ex - ax);
        const head = Math.max(8, sw * 3.5);
        drawSegment(buf, w, h, ex, ey, ex - head * Math.cos(ang - 0.45), ey - head * Math.sin(ang - 0.45), sw, sc);
        drawSegment(buf, w, h, ex, ey, ex - head * Math.cos(ang + 0.45), ey - head * Math.sin(ang + 0.45), sw, sc);
      }
    } else if (el.type === 'text') {
      const tc = applyOp(parseColor(el.color) || [226, 232, 240, 255], op);
      const fs = Math.max(10, (el.fontSize || 20) * scale);
      const barW = Math.max(24, [...String(el.text || '')].length * fs * 0.55);
      drawRoundedRect(buf, w, h, el.x * scale, el.y * scale, barW, fs, 3, [tc[0], tc[1], tc[2], Math.round(tc[3] * 0.3)], tc, 1);
    }
  }

  return encodeRgbaPng(w, h, buf);
}
