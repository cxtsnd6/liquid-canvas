import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasStore, computeElementBounds } from '../server/store.mjs';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'lc-store-test-'));
}

test('CanvasStore initializes default board and persists across instances', () => {
  const dir = makeTempDir();
  try {
    const s1 = new CanvasStore(dir);
    const b1 = s1.getOrCreateBoard();
    assert.equal(b1.id, 'main');
    assert.equal(b1.width, 1200);
    assert.equal(b1.height, 800);
    assert.equal(b1.layers.length, 1);

    s1.drawElements('main', [
      { id: 'box-1', type: 'rect', x: 50, y: 60, w: 200, h: 120, glass: true, label: 'Gateway' },
      { id: 'dot-1', type: 'circle', cx: 400, cy: 200, r: 45 },
    ]);

    const s2 = new CanvasStore(dir);
    const b2 = s2.getOrCreateBoard('main');
    assert.equal(b2.elements.length, 2);
    assert.equal(b2.elements[0].id, 'box-1');
    assert.equal(b2.elements[0].glass, true);
    assert.equal(b2.elements[1].type, 'ellipse');
    assert.equal(b2.elements[1].rx, 45);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('updateElements supports relative dx/dy, scale, z-order, and undo/redo', () => {
  const dir = makeTempDir();
  try {
    const store = new CanvasStore(dir);
    store.drawElements('main', [
      { id: 'a', type: 'rect', x: 100, y: 100, w: 100, h: 80 },
      { id: 'b', type: 'text', x: 300, y: 200, text: 'Hello', fontSize: 24 },
      { id: 'c', type: 'freehand', points: [[10, 10], [30, 40]] },
    ]);

    const upd = store.updateElements('main', [
      { id: 'a', dx: 25, dy: -10, scale: 1.5, bringToFront: true },
      { id: 'b', text: 'World', dx: 15 },
      { id: 'c', dx: 5, dy: 5 },
      { id: 'missing-id', dx: 1 },
    ]);
    assert.deepEqual(upd.updatedIds, ['a', 'b', 'c']);
    assert.deepEqual(upd.missingIds, ['missing-id']);

    const board = store.getOrCreateBoard('main');
    const elA = board.elements.find((e) => e.id === 'a');
    assert.equal(elA.x, 125);
    assert.equal(elA.y, 90);
    assert.equal(elA.w, 150);
    assert.equal(board.elements[board.elements.length - 1].id, 'a');

    const elB = board.elements.find((e) => e.id === 'b');
    assert.equal(elB.text, 'World');
    assert.equal(elB.x, 315);

    const elC = board.elements.find((e) => e.id === 'c');
    assert.deepEqual(elC.points[0], { x: 15, y: 15 });

    // Undo restores previous coordinates and order
    const u1 = store.undo('main');
    assert.equal(u1.changed, true);
    assert.equal(u1.board.elements.find((e) => e.id === 'a').x, 100);
    assert.equal(u1.board.elements.find((e) => e.id === 'b').text, 'Hello');

    const r1 = store.redo('main');
    assert.equal(r1.changed, true);
    assert.equal(r1.board.elements.find((e) => e.id === 'a').x, 125);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manageLayers and multi-board lifecycle enforce safety invariants', () => {
  const dir = makeTempDir();
  try {
    const store = new CanvasStore(dir);
    store.manageLayers('main', { action: 'create', layerId: 'sketch', name: '草图' });
    store.drawElements('main', [{ id: 's1', type: 'line', x1: 0, y1: 0, x2: 100, y2: 100 }], { layerId: 'sketch' });
    store.manageLayers('main', { action: 'reorder', order: ['sketch', 'layer-1'] });
    assert.deepEqual(store.getOrCreateBoard('main').layers.map((l) => l.id), ['sketch', 'layer-1']);

    store.manageLayers('main', { action: 'delete', layerId: 'sketch' });
    assert.equal(store.getOrCreateBoard('main').elements.length, 0);
    assert.throws(() => store.manageLayers('main', { action: 'delete', layerId: 'layer-1' }));

    store.createBoard('wireframe', { title: 'UI 线框图', width: 1440, height: 900 });
    assert.equal(store.getActiveBoardId(), 'wireframe');
    assert.equal(store.listBoards().length, 2);
    store.deleteBoard('wireframe');
    assert.equal(store.getActiveBoardId(), 'main');
    assert.throws(() => store.deleteBoard('main'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('computeElementBounds and snapshots behave accurately', () => {
  const dir = makeTempDir();
  try {
    const b = computeElementBounds({ type: 'path', x: 10, y: 20, scaleX: 2, scaleY: 2, d: 'M 0 0 L 20 30' });
    assert.deepEqual(b, { x: 10, y: 20, w: 40, h: 60 });

    const store = new CanvasStore(dir);
    const board = store.getOrCreateBoard('main');
    const fakePng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
    assert.equal(store.saveSnapshot('main', board.revision, `data:image/png;base64,${fakePng.toString('base64')}`), true);
    assert.ok(store.getFreshSnapshot('main'));

    store.drawElements('main', [{ type: 'rect', x: 10, y: 10, w: 50, h: 50 }]);
    // Snapshot from older revision should no longer count as fresh
    assert.equal(store.getFreshSnapshot('main'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
