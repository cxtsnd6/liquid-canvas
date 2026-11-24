import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;
const MAX_HISTORY = 60;

export function sanitizeId(raw, fallback = 'main') {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function atomicWriteFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, filePath);
  } finally {
    if (existsSync(tmpPath)) {
      try { rmSync(tmpPath, { force: true }); } catch {}
    }
  }
}

export function normalizePoint(pt) {
  if (Array.isArray(pt)) {
    const out = { x: toNum(pt[0]), y: toNum(pt[1]) };
    if (pt.length > 2 && Number.isFinite(Number(pt[2]))) out.p = clamp(Number(pt[2]), 0.05, 1.5);
    return out;
  }
  const out = { x: toNum(pt?.x), y: toNum(pt?.y) };
  if (pt?.p !== undefined && Number.isFinite(Number(pt.p))) {
    out.p = clamp(Number(pt.p), 0.05, 1.5);
  }
  return out;
}

export function parseSvgPathBounds(d) {
  if (typeof d !== 'string' || !d.trim()) return { x: 0, y: 0, w: 40, h: 40 };
  const nums = d.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi);
  if (!nums || nums.length < 2) return { x: 0, y: 0, w: 40, h: 40 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // Rough envelope from coordinate pairs in path commands
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 40, h: 40 };
  return {
    x: minX,
    y: minY,
    w: Math.max(8, maxX - minX),
    h: Math.max(8, maxY - minY),
  };
}

export function computeElementBounds(el) {
  if (!el || typeof el !== 'object') return { x: 0, y: 0, w: 0, h: 0 };
  switch (el.type) {
    case 'rect':
    case 'image':
      return {
        x: toNum(el.x),
        y: toNum(el.y),
        w: Math.max(1, toNum(el.w, 80)),
        h: Math.max(1, toNum(el.h, 60)),
      };
    case 'ellipse': {
      const rx = Math.max(1, toNum(el.rx, 40));
      const ry = Math.max(1, toNum(el.ry, 40));
      return {
        x: toNum(el.cx) - rx,
        y: toNum(el.cy) - ry,
        w: rx * 2,
        h: ry * 2,
      };
    }
    case 'line':
    case 'arrow': {
      const xs = [toNum(el.x1), toNum(el.x2)];
      const ys = [toNum(el.y1), toNum(el.y2)];
      if (el.cx !== undefined && el.cy !== undefined) {
        xs.push(toNum(el.cx));
        ys.push(toNum(el.cy));
      }
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return { x: minX, y: minY, w: Math.max(4, maxX - minX), h: Math.max(4, maxY - minY) };
    }
    case 'freehand':
    case 'polygon': {
      const pts = Array.isArray(el.points) ? el.points : [];
      if (pts.length === 0) return { x: 0, y: 0, w: 10, h: 10 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = Math.max(2, toNum(el.strokeWidth, 3) / 2);
      return {
        x: minX - pad,
        y: minY - pad,
        w: Math.max(6, maxX - minX + pad * 2),
        h: Math.max(6, maxY - minY + pad * 2),
      };
    }
    case 'path': {
      const base = parseSvgPathBounds(el.d);
      const sx = toNum(el.scaleX, 1);
      const sy = toNum(el.scaleY, 1);
      return {
        x: toNum(el.x) + base.x * sx,
        y: toNum(el.y) + base.y * sy,
        w: Math.max(8, Math.abs(base.w * sx)),
        h: Math.max(8, Math.abs(base.h * sy)),
      };
    }
    case 'text': {
      const text = String(el.text ?? '');
      const fontSize = Math.max(10, toNum(el.fontSize, 20));
      const lines = text.split(/\r?\n/);
      const maxChars = lines.reduce((m, l) => Math.max(m, [...l].length), 1);
      const estW = Math.max(24, el.maxWidth ? Math.min(el.maxWidth, maxChars * fontSize * 0.65) : maxChars * fontSize * 0.65);
      const estH = Math.max(fontSize * 1.35, lines.length * fontSize * 1.35);
      const pad = toNum(el.padding, el.background ? 10 : 0);
      let x = toNum(el.x);
      if (el.align === 'center') x -= estW / 2;
      else if (el.align === 'right') x -= estW;
      return {
        x: x - pad,
        y: toNum(el.y) - pad,
        w: estW + pad * 2,
        h: estH + pad * 2,
      };
    }
    default:
      return { x: toNum(el.x), y: toNum(el.y), w: toNum(el.w, 40), h: toNum(el.h, 40) };
  }
}

export function normalizeElement(raw, { defaultLayerId = 'layer-1', defaultAuthor = 'agent', nextZ = 0 } = {}) {
  const type = String(raw?.type || 'rect').toLowerCase();
  const id = raw?.id ? String(raw.id) : `el_${randomUUID().slice(0, 8)}`;
  const base = {
    id,
    type,
    layerId: raw?.layerId ? String(raw.layerId) : defaultLayerId,
    author: raw?.author === 'user' ? 'user' : (raw?.author === 'agent' ? 'agent' : defaultAuthor),
    zIndex: Number.isFinite(Number(raw?.zIndex)) ? Number(raw.zIndex) : nextZ,
    opacity: raw?.opacity !== undefined ? clamp(toNum(raw.opacity, 1), 0, 1) : 1,
    rotation: toNum(raw?.rotation, 0),
    visible: raw?.visible !== false,
    locked: Boolean(raw?.locked),
  };
  if (raw?.label !== undefined && raw.label !== null && String(raw.label).trim()) {
    base.label = String(raw.label).trim();
  }

  switch (type) {
    case 'freehand':
    case 'stroke': {
      base.type = 'freehand';
      base.brush = ['pen', 'marker', 'highlighter', 'glow', 'eraser'].includes(raw?.brush) ? raw.brush : 'pen';
      base.stroke = raw?.stroke || raw?.color || (base.brush === 'glow' ? '#38bdf8' : '#0ea5e9');
      base.strokeWidth = Math.max(1, toNum(raw?.strokeWidth ?? raw?.width, base.brush === 'highlighter' ? 18 : 4));
      base.smooth = raw?.smooth !== false;
      base.points = Array.isArray(raw?.points) ? raw.points.map(normalizePoint) : [];
      if (base.brush === 'highlighter' && raw?.opacity === undefined) base.opacity = 0.42;
      break;
    }
    case 'rect': {
      let x = toNum(raw?.x, 100);
      let y = toNum(raw?.y, 100);
      let w = toNum(raw?.w ?? raw?.width, 180);
      let h = toNum(raw?.h ?? raw?.height, 110);
      if (w < 0) { x += w; w = Math.abs(w); }
      if (h < 0) { y += h; h = Math.abs(h); }
      base.x = x;
      base.y = y;
      base.w = Math.max(2, w);
      base.h = Math.max(2, h);
      base.radius = Math.max(0, toNum(raw?.radius ?? raw?.rx, 14));
      base.fill = raw?.fill !== undefined ? raw.fill : 'rgba(56, 189, 248, 0.16)';
      if (raw?.fillGradient) base.fillGradient = cloneJson(raw.fillGradient);
      base.stroke = raw?.stroke !== undefined ? raw.stroke : '#38bdf8';
      base.strokeWidth = Math.max(0, toNum(raw?.strokeWidth, 2));
      if (Array.isArray(raw?.dash)) base.dash = raw.dash.map(Number).filter(Number.isFinite);
      if (raw?.glass) base.glass = true;
      if (raw?.shadow) base.shadow = raw.shadow;
      break;
    }
    case 'ellipse':
    case 'circle': {
      base.type = 'ellipse';
      if (raw?.cx !== undefined || raw?.cy !== undefined || raw?.rx !== undefined || raw?.ry !== undefined || raw?.r !== undefined) {
        const r = raw?.r !== undefined ? Math.max(2, toNum(raw.r)) : undefined;
        base.cx = toNum(raw?.cx, 200);
        base.cy = toNum(raw?.cy, 200);
        base.rx = Math.max(2, toNum(raw?.rx ?? r, 55));
        base.ry = Math.max(2, toNum(raw?.ry ?? r, 55));
      } else {
        const x = toNum(raw?.x, 120);
        const y = toNum(raw?.y, 120);
        const w = Math.abs(toNum(raw?.w ?? raw?.width, 110));
        const h = Math.abs(toNum(raw?.h ?? raw?.height, 110));
        base.rx = Math.max(2, w / 2);
        base.ry = Math.max(2, h / 2);
        base.cx = x + base.rx;
        base.cy = y + base.ry;
      }
      base.fill = raw?.fill !== undefined ? raw.fill : 'rgba(139, 92, 246, 0.18)';
      if (raw?.fillGradient) base.fillGradient = cloneJson(raw.fillGradient);
      base.stroke = raw?.stroke !== undefined ? raw.stroke : '#8b5cf6';
      base.strokeWidth = Math.max(0, toNum(raw?.strokeWidth, 2));
      if (Array.isArray(raw?.dash)) base.dash = raw.dash.map(Number).filter(Number.isFinite);
      if (raw?.shadow) base.shadow = raw.shadow;
      break;
    }
    case 'line':
    case 'arrow': {
      base.type = type;
      base.x1 = toNum(raw?.x1, 100);
      base.y1 = toNum(raw?.y1, 100);
      base.x2 = toNum(raw?.x2, 280);
      base.y2 = toNum(raw?.y2, 180);
      if (raw?.cx !== undefined && raw?.cy !== undefined) {
        base.cx = toNum(raw.cx);
        base.cy = toNum(raw.cy);
      }
      base.stroke = raw?.stroke || raw?.color || '#38bdf8';
      base.strokeWidth = Math.max(1, toNum(raw?.strokeWidth, 2.5));
      base.startArrow = raw?.startArrow || 'none';
      base.endArrow = raw?.endArrow || (type === 'arrow' ? 'arrow' : 'none');
      if (Array.isArray(raw?.dash)) base.dash = raw.dash.map(Number).filter(Number.isFinite);
      if (raw?.labelBg) base.labelBg = raw.labelBg;
      break;
    }
    case 'polygon':
    case 'polyline': {
      base.type = 'polygon';
      base.points = Array.isArray(raw?.points) ? raw.points.map(normalizePoint) : [];
      base.closed = raw?.closed !== undefined ? Boolean(raw.closed) : (type === 'polygon');
      base.fill = raw?.fill !== undefined ? raw.fill : (base.closed ? 'rgba(56, 189, 248, 0.14)' : 'none');
      base.stroke = raw?.stroke !== undefined ? raw.stroke : '#38bdf8';
      base.strokeWidth = Math.max(0, toNum(raw?.strokeWidth, 2));
      base.smooth = Boolean(raw?.smooth);
      if (Array.isArray(raw?.dash)) base.dash = raw.dash.map(Number).filter(Number.isFinite);
      break;
    }
    case 'path': {
      base.type = 'path';
      base.d = String(raw?.d || 'M 0 0 L 40 0');
      base.x = toNum(raw?.x, 0);
      base.y = toNum(raw?.y, 0);
      base.scaleX = toNum(raw?.scaleX ?? raw?.scale, 1);
      base.scaleY = toNum(raw?.scaleY ?? raw?.scale, 1);
      base.fill = raw?.fill !== undefined ? raw.fill : 'none';
      base.stroke = raw?.stroke !== undefined ? raw.stroke : '#38bdf8';
      base.strokeWidth = Math.max(0, toNum(raw?.strokeWidth, 2.5));
      if (Array.isArray(raw?.dash)) base.dash = raw.dash.map(Number).filter(Number.isFinite);
      if (raw?.shadow) base.shadow = raw.shadow;
      break;
    }
    case 'text': {
      base.type = 'text';
      base.x = toNum(raw?.x, 120);
      base.y = toNum(raw?.y, 120);
      base.text = String(raw?.text ?? 'Text');
      base.fontSize = Math.max(8, toNum(raw?.fontSize, 20));
      base.fontFamily = String(raw?.fontFamily || 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif');
      base.fontWeight = String(raw?.fontWeight || '500');
      base.color = raw?.color || raw?.fill || '#e2e8f0';
      base.align = ['left', 'center', 'right'].includes(raw?.align) ? raw.align : 'left';
      if (raw?.maxWidth) base.maxWidth = Math.max(40, toNum(raw.maxWidth));
      if (raw?.background) base.background = String(raw.background);
      if (raw?.padding !== undefined) base.padding = Math.max(0, toNum(raw.padding));
      if (raw?.radius !== undefined) base.radius = Math.max(0, toNum(raw.radius));
      break;
    }
    case 'image': {
      base.type = 'image';
      base.x = toNum(raw?.x, 80);
      base.y = toNum(raw?.y, 80);
      base.w = Math.max(8, toNum(raw?.w ?? raw?.width, 240));
      base.h = Math.max(8, toNum(raw?.h ?? raw?.height, 180));
      base.src = String(raw?.src || '');
      base.radius = Math.max(0, toNum(raw?.radius, 12));
      break;
    }
    default:
      base.type = 'rect';
      base.x = toNum(raw?.x, 100);
      base.y = toNum(raw?.y, 100);
      base.w = Math.max(2, toNum(raw?.w, 120));
      base.h = Math.max(2, toNum(raw?.h, 80));
      base.radius = 12;
      base.fill = 'rgba(56, 189, 248, 0.16)';
      base.stroke = '#38bdf8';
      base.strokeWidth = 2;
  }

  return base;
}

export function applyElementPatch(el, patch) {
  const next = cloneJson(el);
  if (!patch || typeof patch !== 'object') return next;

  const dx = toNum(patch.dx, 0);
  const dy = toNum(patch.dy, 0);

  // Common metadata
  for (const key of ['layerId', 'author', 'label', 'visible', 'locked', 'rotation', 'opacity', 'zIndex']) {
    if (patch[key] !== undefined) {
      if (key === 'opacity') next.opacity = clamp(toNum(patch.opacity, next.opacity), 0, 1);
      else if (key === 'rotation' || key === 'zIndex') next[key] = toNum(patch[key], next[key]);
      else if (key === 'visible' || key === 'locked') next[key] = Boolean(patch[key]);
      else if (key === 'label') {
        if (patch.label === null || patch.label === '') delete next.label;
        else next.label = String(patch.label);
      } else {
        next[key] = String(patch[key]);
      }
    }
  }

  // Style patches
  for (const key of ['fill', 'fillGradient', 'stroke', 'strokeWidth', 'dash', 'glass', 'shadow', 'brush', 'smooth', 'radius', 'closed', 'startArrow', 'endArrow', 'labelBg', 'text', 'fontSize', 'fontFamily', 'fontWeight', 'color', 'align', 'maxWidth', 'background', 'padding', 'd', 'src']) {
    if (patch[key] !== undefined) {
      if (patch[key] === null && ['fillGradient', 'dash', 'shadow', 'labelBg', 'maxWidth', 'background'].includes(key)) {
        delete next[key];
      } else {
        next[key] = cloneJson(patch[key]);
      }
    }
  }

  // Geometry patches by type
  if (next.type === 'rect' || next.type === 'image') {
    if (patch.x !== undefined) next.x = toNum(patch.x, next.x);
    if (patch.y !== undefined) next.y = toNum(patch.y, next.y);
    if (patch.w !== undefined || patch.width !== undefined) next.w = Math.max(2, toNum(patch.w ?? patch.width, next.w));
    if (patch.h !== undefined || patch.height !== undefined) next.h = Math.max(2, toNum(patch.h ?? patch.height, next.h));
    if (dx) next.x += dx;
    if (dy) next.y += dy;
    if (patch.scale !== undefined) {
      const s = Math.max(0.05, toNum(patch.scale, 1));
      next.w = Math.max(2, next.w * s);
      next.h = Math.max(2, next.h * s);
    }
  } else if (next.type === 'ellipse') {
    if (patch.cx !== undefined) next.cx = toNum(patch.cx, next.cx);
    if (patch.cy !== undefined) next.cy = toNum(patch.cy, next.cy);
    if (patch.rx !== undefined) next.rx = Math.max(2, toNum(patch.rx, next.rx));
    if (patch.ry !== undefined) next.ry = Math.max(2, toNum(patch.ry, next.ry));
    if (patch.r !== undefined) {
      next.rx = Math.max(2, toNum(patch.r, next.rx));
      next.ry = Math.max(2, toNum(patch.r, next.ry));
    }
    if (patch.x !== undefined) next.cx = toNum(patch.x) + next.rx;
    if (patch.y !== undefined) next.cy = toNum(patch.y) + next.ry;
    if (patch.w !== undefined) next.rx = Math.max(2, toNum(patch.w) / 2);
    if (patch.h !== undefined) next.ry = Math.max(2, toNum(patch.h) / 2);
    if (dx) next.cx += dx;
    if (dy) next.cy += dy;
    if (patch.scale !== undefined) {
      const s = Math.max(0.05, toNum(patch.scale, 1));
      next.rx = Math.max(2, next.rx * s);
      next.ry = Math.max(2, next.ry * s);
    }
  } else if (next.type === 'line' || next.type === 'arrow') {
    for (const k of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy']) {
      if (patch[k] !== undefined) {
        if (patch[k] === null && (k === 'cx' || k === 'cy')) delete next[k];
        else next[k] = toNum(patch[k], next[k]);
      }
    }
    if (dx || dy) {
      next.x1 += dx; next.x2 += dx;
      next.y1 += dy; next.y2 += dy;
      if (next.cx !== undefined) next.cx += dx;
      if (next.cy !== undefined) next.cy += dy;
    }
  } else if (next.type === 'freehand' || next.type === 'polygon') {
    if (Array.isArray(patch.points)) {
      next.points = patch.points.map(normalizePoint);
    }
    if (dx || dy || patch.scale !== undefined) {
      const bounds = computeElementBounds(next);
      const cx = bounds.x + bounds.w / 2;
      const cy = bounds.y + bounds.h / 2;
      const s = patch.scale !== undefined ? Math.max(0.05, toNum(patch.scale, 1)) : 1;
      next.points = (next.points || []).map((pt) => ({
        ...pt,
        x: cx + (pt.x - cx) * s + dx,
        y: cy + (pt.y - cy) * s + dy,
      }));
    }
  } else if (next.type === 'path') {
    if (patch.x !== undefined) next.x = toNum(patch.x, next.x);
    if (patch.y !== undefined) next.y = toNum(patch.y, next.y);
    if (patch.scaleX !== undefined) next.scaleX = toNum(patch.scaleX, next.scaleX);
    if (patch.scaleY !== undefined) next.scaleY = toNum(patch.scaleY, next.scaleY);
    if (patch.scale !== undefined) {
      const s = toNum(patch.scale, 1);
      next.scaleX = s;
      next.scaleY = s;
    }
    if (dx) next.x += dx;
    if (dy) next.y += dy;
  } else if (next.type === 'text') {
    if (patch.x !== undefined) next.x = toNum(patch.x, next.x);
    if (patch.y !== undefined) next.y = toNum(patch.y, next.y);
    if (dx) next.x += dx;
    if (dy) next.y += dy;
  }

  return next;
}

export function createDefaultBoard(id = 'main', title = '主画板') {
  return {
    id: sanitizeId(id, 'main'),
    title: String(title || '主画板'),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    background: 'auto',
    showGrid: true,
    revision: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
    activeLayerId: 'layer-1',
    layers: [
      { id: 'layer-1', name: '图层 1', visible: true, locked: false, opacity: 1 },
    ],
    elements: [],
  };
}

export class CanvasStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.boardsDir = join(dataDir, 'boards');
    this.snapshotsDir = join(dataDir, 'snapshots');
    this.metaPath = join(dataDir, 'meta.json');
    this.boards = new Map();
    this.undoStacks = new Map();
    this.redoStacks = new Map();
    this.snapshots = new Map(); // boardId -> { revision, pngBuffer, updatedAt }
    this.activeBoardId = 'main';
    this.#init();
  }

  #init() {
    mkdirSync(this.boardsDir, { recursive: true });
    mkdirSync(this.snapshotsDir, { recursive: true });

    if (existsSync(this.metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(this.metaPath, 'utf8'));
        if (meta?.activeBoardId) this.activeBoardId = sanitizeId(meta.activeBoardId, 'main');
      } catch {}
    }

    for (const file of readdirSync(this.boardsDir)) {
      if (!file.endsWith('.json')) continue;
      const id = sanitizeId(file.slice(0, -5), '');
      if (!id) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(this.boardsDir, file), 'utf8'));
        if (parsed && typeof parsed === 'object') {
          this.boards.set(id, this.#sanitizeBoard(parsed, id));
        }
      } catch {}
    }

    if (!this.boards.size) {
      const def = createDefaultBoard('main', '主画板');
      this.boards.set('main', def);
      this.activeBoardId = 'main';
      this.#persistBoard(def);
      this.#persistMeta();
    } else if (!this.boards.has(this.activeBoardId)) {
      this.activeBoardId = this.boards.keys().next().value;
      this.#persistMeta();
    }

    // Load cached snapshots if present
    for (const boardId of this.boards.keys()) {
      const pngPath = join(this.snapshotsDir, `${boardId}.png`);
      const revPath = join(this.snapshotsDir, `${boardId}.rev`);
      if (existsSync(pngPath) && existsSync(revPath)) {
        try {
          const rev = Number(readFileSync(revPath, 'utf8').trim());
          const pngBuffer = readFileSync(pngPath);
          if (Number.isFinite(rev) && pngBuffer.length > 8) {
            this.snapshots.set(boardId, { revision: rev, pngBuffer, updatedAt: new Date().toISOString() });
          }
        } catch {}
      }
    }
  }

  #sanitizeBoard(raw, id) {
    const layers = Array.isArray(raw.layers) && raw.layers.length
      ? raw.layers.map((l, idx) => ({
          id: sanitizeId(l?.id || `layer-${idx + 1}`, `layer-${idx + 1}`),
          name: String(l?.name || `图层 ${idx + 1}`),
          visible: l?.visible !== false,
          locked: Boolean(l?.locked),
          opacity: l?.opacity !== undefined ? clamp(toNum(l.opacity, 1), 0, 1) : 1,
        }))
      : [{ id: 'layer-1', name: '图层 1', visible: true, locked: false, opacity: 1 }];
    const activeLayerId = layers.some((l) => l.id === raw.activeLayerId) ? raw.activeLayerId : layers[0].id;
    const elements = Array.isArray(raw.elements)
      ? raw.elements.map((el, i) => normalizeElement(el, { defaultLayerId: activeLayerId, nextZ: i }))
      : [];
    return {
      id: sanitizeId(raw.id || id, id),
      title: String(raw.title || id),
      width: clamp(toNum(raw.width, DEFAULT_WIDTH), 200, 4096),
      height: clamp(toNum(raw.height, DEFAULT_HEIGHT), 200, 4096),
      background: String(raw.background || 'auto'),
      showGrid: raw.showGrid !== false,
      revision: Math.max(1, Math.floor(toNum(raw.revision, 1))),
      updatedAt: String(raw.updatedAt || new Date().toISOString()),
      updatedBy: String(raw.updatedBy || 'system'),
      activeLayerId,
      layers,
      elements,
    };
  }

  #persistMeta() {
    atomicWriteFile(this.metaPath, JSON.stringify({ activeBoardId: this.activeBoardId }, null, 2));
  }

  #persistBoard(board) {
    atomicWriteFile(join(this.boardsDir, `${board.id}.json`), JSON.stringify(board, null, 2));
  }

  #snapshotForHistory(board) {
    return {
      title: board.title,
      width: board.width,
      height: board.height,
      background: board.background,
      showGrid: board.showGrid,
      activeLayerId: board.activeLayerId,
      layers: cloneJson(board.layers),
      elements: cloneJson(board.elements),
    };
  }

  #pushUndo(board) {
    const stack = this.undoStacks.get(board.id) || [];
    stack.push(this.#snapshotForHistory(board));
    if (stack.length > MAX_HISTORY) stack.shift();
    this.undoStacks.set(board.id, stack);
    this.redoStacks.set(board.id, []);
  }

  #commit(board, updatedBy = 'agent') {
    board.revision += 1;
    board.updatedAt = new Date().toISOString();
    board.updatedBy = updatedBy;
    this.#sortElements(board);
    this.#persistBoard(board);
    return board;
  }

  #sortElements(board) {
    board.elements.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    board.elements.forEach((el, idx) => { el.zIndex = idx; });
  }

  #nextZ(board) {
    if (!board.elements.length) return 0;
    return board.elements.reduce((m, el) => Math.max(m, el.zIndex ?? 0), -1) + 1;
  }

  getActiveBoardId() {
    return this.activeBoardId;
  }

  listBoards() {
    return Array.from(this.boards.values()).map((b) => ({
      id: b.id,
      title: b.title,
      width: b.width,
      height: b.height,
      elementCount: b.elements.length,
      layerCount: b.layers.length,
      revision: b.revision,
      updatedAt: b.updatedAt,
      active: b.id === this.activeBoardId,
    }));
  }

  getOrCreateBoard(boardId, { title, width, height, background } = {}) {
    const id = boardId ? sanitizeId(boardId, this.activeBoardId) : this.activeBoardId;
    let board = this.boards.get(id);
    if (!board) {
      board = createDefaultBoard(id, title || id);
      if (width) board.width = clamp(toNum(width, DEFAULT_WIDTH), 200, 4096);
      if (height) board.height = clamp(toNum(height, DEFAULT_HEIGHT), 200, 4096);
      if (background) board.background = String(background);
      this.boards.set(id, board);
      this.#persistBoard(board);
    }
    return board;
  }

  switchBoard(boardId) {
    const id = sanitizeId(boardId, '');
    if (!id) throw new Error('Invalid board_id');
    const board = this.getOrCreateBoard(id);
    this.activeBoardId = board.id;
    this.#persistMeta();
    return board;
  }

  createBoard(boardId, { title, width, height, background, activate = true } = {}) {
    const id = sanitizeId(boardId || `board-${Date.now().toString(36)}`, `board-${Date.now().toString(36)}`);
    if (this.boards.has(id)) {
      const existing = this.boards.get(id);
      if (activate) {
        this.activeBoardId = id;
        this.#persistMeta();
      }
      return existing;
    }
    const board = createDefaultBoard(id, title || id);
    if (width) board.width = clamp(toNum(width, DEFAULT_WIDTH), 200, 4096);
    if (height) board.height = clamp(toNum(height, DEFAULT_HEIGHT), 200, 4096);
    if (background) board.background = String(background);
    this.boards.set(id, board);
    this.#persistBoard(board);
    if (activate) {
      this.activeBoardId = id;
      this.#persistMeta();
    }
    return board;
  }

  deleteBoard(boardId) {
    const id = sanitizeId(boardId, '');
    if (!this.boards.has(id)) return false;
    if (this.boards.size <= 1) throw new Error('Cannot delete the only remaining board');
    this.boards.delete(id);
    this.undoStacks.delete(id);
    this.redoStacks.delete(id);
    this.snapshots.delete(id);
    try { rmSync(join(this.boardsDir, `${id}.json`), { force: true }); } catch {}
    try { rmSync(join(this.snapshotsDir, `${id}.png`), { force: true }); } catch {}
    try { rmSync(join(this.snapshotsDir, `${id}.rev`), { force: true }); } catch {}
    if (this.activeBoardId === id) {
      this.activeBoardId = this.boards.keys().next().value;
      this.#persistMeta();
    }
    return true;
  }

  setCanvasConfig(boardId, patch = {}, author = 'agent') {
    const board = this.getOrCreateBoard(boardId);
    this.#pushUndo(board);
    if (patch.title !== undefined) board.title = String(patch.title || board.title);
    if (patch.width !== undefined) board.width = clamp(toNum(patch.width, board.width), 200, 4096);
    if (patch.height !== undefined) board.height = clamp(toNum(patch.height, board.height), 200, 4096);
    if (patch.background !== undefined) board.background = String(patch.background);
    if (patch.showGrid !== undefined) board.showGrid = Boolean(patch.showGrid);
    return this.#commit(board, author);
  }

  drawElements(boardId, elements = [], { author = 'agent', layerId, replaceIds } = {}) {
    const board = this.getOrCreateBoard(boardId);
    this.#pushUndo(board);
    const targetLayer = layerId && board.layers.some((l) => l.id === layerId)
      ? layerId
      : board.activeLayerId;

    if (Array.isArray(replaceIds) && replaceIds.length) {
      const drop = new Set(replaceIds.map(String));
      board.elements = board.elements.filter((el) => !drop.has(el.id));
    }

    let z = this.#nextZ(board);
    const created = [];
    const existingIds = new Set(board.elements.map((e) => e.id));
    for (const raw of elements) {
      const normalized = normalizeElement(raw, {
        defaultLayerId: targetLayer,
        defaultAuthor: author,
        nextZ: z++,
      });
      if (existingIds.has(normalized.id)) {
        // Replace existing element with same ID if agent draws over same semantic ID
        board.elements = board.elements.filter((e) => e.id !== normalized.id);
      }
      existingIds.add(normalized.id);
      board.elements.push(normalized);
      created.push(normalized);
    }

    this.#commit(board, author);
    return { board, created };
  }

  updateElements(boardId, updates = [], { author = 'agent' } = {}) {
    const board = this.getOrCreateBoard(boardId);
    const byId = new Map(board.elements.map((e) => [e.id, e]));
    const updatedIds = [];
    const missingIds = [];

    for (const item of updates) {
      if (!item?.id || !byId.has(String(item.id))) {
        if (item?.id) missingIds.push(String(item.id));
      }
    }
    if (updates.length > 0 && missingIds.length === updates.length) {
      return { board, updatedIds: [], missingIds };
    }

    this.#pushUndo(board);
    for (const item of updates) {
      const id = String(item?.id || '');
      const current = byId.get(id);
      if (!current) continue;
      let next = applyElementPatch(current, item);
      if (item.bringToFront) next.zIndex = this.#nextZ(board);
      else if (item.sendToBack) next.zIndex = -1;
      byId.set(id, next);
      updatedIds.push(id);
    }
    board.elements = Array.from(byId.values());
    this.#commit(board, author);
    return { board, updatedIds, missingIds };
  }

  deleteElements(boardId, ids = [], { author = 'agent' } = {}) {
    const board = this.getOrCreateBoard(boardId);
    const drop = new Set(ids.map(String));
    const before = board.elements.length;
    const remaining = board.elements.filter((el) => !drop.has(el.id));
    const deletedCount = before - remaining.length;
    if (deletedCount === 0) return { board, deletedCount: 0 };
    this.#pushUndo(board);
    board.elements = remaining;
    this.#commit(board, author);
    return { board, deletedCount };
  }

  clearBoard(boardId, { layerId, author = 'agent' } = {}) {
    const board = this.getOrCreateBoard(boardId);
    if (!board.elements.length) return board;
    this.#pushUndo(board);
    if (layerId) {
      board.elements = board.elements.filter((el) => el.layerId !== layerId);
    } else {
      board.elements = [];
    }
    return this.#commit(board, author);
  }

  undo(boardId, author = 'user') {
    const board = this.getOrCreateBoard(boardId);
    const stack = this.undoStacks.get(board.id) || [];
    if (!stack.length) return { board, changed: false };
    const redoStack = this.redoStacks.get(board.id) || [];
    redoStack.push(this.#snapshotForHistory(board));
    this.redoStacks.set(board.id, redoStack);
    const prev = stack.pop();
    Object.assign(board, prev);
    this.#commit(board, author);
    return { board, changed: true };
  }

  redo(boardId, author = 'user') {
    const board = this.getOrCreateBoard(boardId);
    const redoStack = this.redoStacks.get(board.id) || [];
    if (!redoStack.length) return { board, changed: false };
    const undoStack = this.undoStacks.get(board.id) || [];
    undoStack.push(this.#snapshotForHistory(board));
    this.undoStacks.set(board.id, undoStack);
    const next = redoStack.pop();
    Object.assign(board, next);
    this.#commit(board, author);
    return { board, changed: true };
  }

  manageLayers(boardId, { action, layerId, name, visible, locked, opacity, order } = {}, author = 'agent') {
    const board = this.getOrCreateBoard(boardId);
    switch (action) {
      case 'list':
        return { board, layers: board.layers };
      case 'create': {
        this.#pushUndo(board);
        const id = sanitizeId(layerId || `layer-${Date.now().toString(36)}`, `layer-${board.layers.length + 1}`);
        if (!board.layers.some((l) => l.id === id)) {
          board.layers.push({
            id,
            name: String(name || `图层 ${board.layers.length + 1}`),
            visible: visible !== false,
            locked: Boolean(locked),
            opacity: opacity !== undefined ? clamp(toNum(opacity, 1), 0, 1) : 1,
          });
        }
        board.activeLayerId = id;
        this.#commit(board, author);
        return { board, layers: board.layers };
      }
      case 'update': {
        const layer = board.layers.find((l) => l.id === layerId);
        if (!layer) throw new Error(`Layer not found: ${layerId}`);
        this.#pushUndo(board);
        if (name !== undefined) layer.name = String(name);
        if (visible !== undefined) layer.visible = Boolean(visible);
        if (locked !== undefined) layer.locked = Boolean(locked);
        if (opacity !== undefined) layer.opacity = clamp(toNum(opacity, layer.opacity), 0, 1);
        if (layerId && arguments[1]?.activate) board.activeLayerId = layerId;
        this.#commit(board, author);
        return { board, layers: board.layers };
      }
      case 'activate': {
        if (!board.layers.some((l) => l.id === layerId)) throw new Error(`Layer not found: ${layerId}`);
        board.activeLayerId = layerId;
        this.#persistBoard(board);
        return { board, layers: board.layers };
      }
      case 'delete': {
        if (board.layers.length <= 1) throw new Error('Cannot delete the only remaining layer');
        if (!board.layers.some((l) => l.id === layerId)) throw new Error(`Layer not found: ${layerId}`);
        this.#pushUndo(board);
        board.layers = board.layers.filter((l) => l.id !== layerId);
        board.elements = board.elements.filter((e) => e.layerId !== layerId);
        if (board.activeLayerId === layerId) board.activeLayerId = board.layers[0].id;
        this.#commit(board, author);
        return { board, layers: board.layers };
      }
      case 'reorder': {
        if (!Array.isArray(order) || !order.length) throw new Error('order array required');
        this.#pushUndo(board);
        const byId = new Map(board.layers.map((l) => [l.id, l]));
        const reordered = [];
        for (const id of order) {
          if (byId.has(id)) {
            reordered.push(byId.get(id));
            byId.delete(id);
          }
        }
        for (const rest of byId.values()) reordered.push(rest);
        board.layers = reordered;
        this.#commit(board, author);
        return { board, layers: board.layers };
      }
      default:
        throw new Error(`Unknown layer action: ${action}`);
    }
  }

  applyAppOps(boardId, ops = []) {
    let board = this.getOrCreateBoard(boardId);
    if (!Array.isArray(ops) || ops.length === 0) return board;

    const nonUndoOps = ops.filter((op) => !['undo', 'redo', 'switch_board', 'create_board', 'delete_board', 'activate_layer'].includes(op?.op));
    if (nonUndoOps.length > 0) {
      this.#pushUndo(board);
    }

    let mutated = false;
    for (const op of ops) {
      if (!op || typeof op !== 'object') continue;
      switch (op.op) {
        case 'add': {
          const items = Array.isArray(op.elements) ? op.elements : (op.element ? [op.element] : []);
          let z = this.#nextZ(board);
          const existingIds = new Set(board.elements.map((e) => e.id));
          for (const raw of items) {
            const normalized = normalizeElement(raw, {
              defaultLayerId: op.layerId || board.activeLayerId,
              defaultAuthor: 'user',
              nextZ: z++,
            });
            if (existingIds.has(normalized.id)) {
              board.elements = board.elements.filter((e) => e.id !== normalized.id);
            }
            existingIds.add(normalized.id);
            board.elements.push(normalized);
          }
          mutated = true;
          break;
        }
        case 'update': {
          const updates = Array.isArray(op.updates) ? op.updates : (op.id ? [op] : []);
          const byId = new Map(board.elements.map((e) => [e.id, e]));
          for (const patch of updates) {
            const cur = byId.get(String(patch.id));
            if (!cur) continue;
            let next = applyElementPatch(cur, patch);
            if (patch.bringToFront) next.zIndex = this.#nextZ(board);
            else if (patch.sendToBack) next.zIndex = -1;
            byId.set(cur.id, next);
          }
          board.elements = Array.from(byId.values());
          mutated = true;
          break;
        }
        case 'delete': {
          const ids = new Set((op.ids || []).map(String));
          board.elements = board.elements.filter((e) => !ids.has(e.id));
          mutated = true;
          break;
        }
        case 'clear': {
          if (op.layerId) board.elements = board.elements.filter((e) => e.layerId !== op.layerId);
          else board.elements = [];
          mutated = true;
          break;
        }
        case 'set_canvas': {
          if (op.title !== undefined) board.title = String(op.title || board.title);
          if (op.width !== undefined) board.width = clamp(toNum(op.width, board.width), 200, 4096);
          if (op.height !== undefined) board.height = clamp(toNum(op.height, board.height), 200, 4096);
          if (op.background !== undefined) board.background = String(op.background);
          if (op.showGrid !== undefined) board.showGrid = Boolean(op.showGrid);
          mutated = true;
          break;
        }
        case 'activate_layer': {
          if (board.layers.some((l) => l.id === op.layerId)) {
            board.activeLayerId = op.layerId;
            this.#persistBoard(board);
          }
          break;
        }
        case 'layer_create': {
          const id = sanitizeId(op.layerId || `layer-${Date.now().toString(36)}`, `layer-${board.layers.length + 1}`);
          if (!board.layers.some((l) => l.id === id)) {
            board.layers.push({
              id,
              name: String(op.name || `图层 ${board.layers.length + 1}`),
              visible: op.visible !== false,
              locked: Boolean(op.locked),
              opacity: op.opacity !== undefined ? clamp(toNum(op.opacity, 1), 0, 1) : 1,
            });
          }
          board.activeLayerId = id;
          mutated = true;
          break;
        }
        case 'layer_update': {
          const l = board.layers.find((x) => x.id === op.layerId);
          if (l) {
            if (op.name !== undefined) l.name = String(op.name);
            if (op.visible !== undefined) l.visible = Boolean(op.visible);
            if (op.locked !== undefined) l.locked = Boolean(op.locked);
            if (op.opacity !== undefined) l.opacity = clamp(toNum(op.opacity, l.opacity), 0, 1);
            mutated = true;
          }
          break;
        }
        case 'layer_delete': {
          if (board.layers.length > 1 && board.layers.some((l) => l.id === op.layerId)) {
            board.layers = board.layers.filter((l) => l.id !== op.layerId);
            board.elements = board.elements.filter((e) => e.layerId !== op.layerId);
            if (board.activeLayerId === op.layerId) board.activeLayerId = board.layers[0].id;
            mutated = true;
          }
          break;
        }
        case 'undo': {
          this.undo(board.id, 'user');
          board = this.getOrCreateBoard(board.id);
          break;
        }
        case 'redo': {
          this.redo(board.id, 'user');
          board = this.getOrCreateBoard(board.id);
          break;
        }
        case 'switch_board': {
          board = this.switchBoard(op.targetBoardId);
          break;
        }
        case 'create_board': {
          board = this.createBoard(op.targetBoardId, {
            title: op.title,
            width: op.width,
            height: op.height,
            background: op.background,
            activate: true,
          });
          break;
        }
        case 'rename_board': {
          board.title = String(op.title || board.title);
          mutated = true;
          break;
        }
        case 'delete_board': {
          this.deleteBoard(op.targetBoardId);
          board = this.getOrCreateBoard(this.activeBoardId);
          break;
        }
      }
    }

    if (mutated) {
      this.#commit(board, 'user');
    }
    return board;
  }

  saveSnapshot(boardId, revision, pngBase64) {
    const id = sanitizeId(boardId, this.activeBoardId);
    const cleaned = String(pngBase64 || '').replace(/^data:image\/png;base64,/, '');
    if (!cleaned) return false;
    const pngBuffer = Buffer.from(cleaned, 'base64');
    if (pngBuffer.length < 24) return false;
    const rev = Number(revision) || (this.boards.get(id)?.revision ?? 1);
    this.snapshots.set(id, { revision: rev, pngBuffer, updatedAt: new Date().toISOString() });
    try {
      atomicWriteFile(join(this.snapshotsDir, `${id}.png`), pngBuffer);
      atomicWriteFile(join(this.snapshotsDir, `${id}.rev`), String(rev));
    } catch {}
    return true;
  }

  getFreshSnapshot(boardId) {
    const board = this.getOrCreateBoard(boardId);
    const snap = this.snapshots.get(board.id);
    if (snap && snap.revision === board.revision) return snap.pngBuffer;
    return null;
  }

  canUndo(boardId) {
    return (this.undoStacks.get(boardId)?.length || 0) > 0;
  }

  canRedo(boardId) {
    return (this.redoStacks.get(boardId)?.length || 0) > 0;
  }

  summarizeBoard(board, { includeElements = true } = {}) {
    const lines = [
      `Board "${board.title}" (id="${board.id}") — ${board.width}×${board.height}, bg="${board.background}", grid=${board.showGrid}, rev=${board.revision}, updatedBy=${board.updatedBy}`,
      `Layers (${board.layers.length}, active="${board.activeLayerId}"): ` +
        board.layers.map((l) => `${l.id}:"${l.name}"[${l.visible ? 'vis' : 'hid'}${l.locked ? ',locked' : ''}]`).join(', '),
      `Elements (${board.elements.length}):`,
    ];

    if (!includeElements || board.elements.length === 0) {
      if (board.elements.length === 0) lines.push('  (empty canvas)');
      return lines.join('\n');
    }

    const maxDetailed = 120;
    const shown = board.elements.slice(0, maxDetailed);
    for (const el of shown) {
      const b = computeElementBounds(el);
      const bStr = `(${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)})`;
      const meta = `[${el.author},${el.layerId}${el.label ? `,label="${el.label}"` : ''}]`;
      if (el.type === 'text') {
        const txt = el.text.length > 48 ? `${el.text.slice(0, 45)}...` : el.text;
        lines.push(`  - ${el.id} text ${bStr} color=${el.color} size=${el.fontSize} "${txt}" ${meta}`);
      } else if (el.type === 'freehand') {
        lines.push(`  - ${el.id} freehand(${el.brush}) ${bStr} pts=${el.points.length} stroke=${el.stroke}(w=${el.strokeWidth}) ${meta}`);
      } else if (el.type === 'line' || el.type === 'arrow') {
        lines.push(`  - ${el.id} ${el.type} (${Math.round(el.x1)},${Math.round(el.y1)})->(${Math.round(el.x2)},${Math.round(el.y2)}) stroke=${el.stroke} ${meta}`);
      } else if (el.type === 'path') {
        lines.push(`  - ${el.id} path ${bStr} fill=${el.fill} stroke=${el.stroke} d="${el.d.slice(0, 40)}${el.d.length > 40 ? '...' : ''}" ${meta}`);
      } else {
        lines.push(`  - ${el.id} ${el.type} ${bStr} fill=${el.fill} stroke=${el.stroke} ${meta}`);
      }
    }
    if (board.elements.length > maxDetailed) {
      lines.push(`  ... and ${board.elements.length - maxDetailed} more elements`);
    }
    return lines.join('\n');
  }
}
