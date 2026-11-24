import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultBoard } from '../server/store.mjs';
import { boardToSvg, parseColor, renderFallbackPng } from '../server/renderer.mjs';

test('parseColor parses hex, short hex, rgb/rgba, and named colors', () => {
  assert.deepEqual(parseColor('#38bdf8'), [56, 189, 248, 255]);
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 255]);
  assert.deepEqual(parseColor('rgba(15, 23, 42, 0.5)'), [15, 23, 42, 128]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
});

test('boardToSvg renders shapes, gradients, curved arrows, paths, and text', () => {
  const board = createDefaultBoard('test', 'SVG Test');
  board.elements = [
    {
      id: 'r1', type: 'rect', layerId: 'layer-1', x: 40, y: 40, w: 200, h: 100, radius: 16,
      fillGradient: { angle: 90, stops: [{ offset: 0, color: '#38bdf8' }, { offset: 1, color: '#8b5cf6' }] },
      stroke: '#ffffff', strokeWidth: 2, opacity: 1, visible: true,
    },
    {
      id: 'a1', type: 'arrow', layerId: 'layer-1', x1: 240, y1: 90, cx: 300, cy: 40, x2: 380, y2: 90,
      stroke: '#38bdf8', strokeWidth: 3, endArrow: 'arrow', label: 'API', opacity: 1, visible: true,
    },
    {
      id: 't1', type: 'text', layerId: 'layer-1', x: 60, y: 70, text: 'Hello <World>', fontSize: 18, color: '#ffffff', opacity: 1, visible: true,
    },
    {
      id: 'hidden', type: 'rect', layerId: 'layer-1', x: 0, y: 0, w: 50, h: 50, visible: false,
    },
  ];
  const svg = boardToSvg(board);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('<linearGradient id="lg_0"'));
  assert.ok(svg.includes('Hello &lt;World&gt;'));
  assert.ok(svg.includes('Q 300 40 380 90'));
  assert.ok(!svg.includes('width="50"'));
});

test('renderFallbackPng outputs a valid PNG binary with scaled dimensions', () => {
  const board = createDefaultBoard('png-test', 'PNG Test');
  board.width = 1200;
  board.height = 800;
  board.elements = [
    { id: 'r1', type: 'rect', layerId: 'layer-1', x: 80, y: 80, w: 300, h: 180, radius: 14, fill: '#38bdf8', stroke: '#ffffff', strokeWidth: 3, opacity: 1, visible: true },
    { id: 'e1', type: 'ellipse', layerId: 'layer-1', cx: 600, cy: 300, rx: 90, ry: 60, fill: '#8b5cf6', stroke: '#ffffff', strokeWidth: 2, opacity: 1, visible: true },
    { id: 'f1', type: 'freehand', layerId: 'layer-1', points: [{ x: 100, y: 500 }, { x: 400, y: 550 }], stroke: '#34d399', strokeWidth: 6, opacity: 1, visible: true },
  ];
  const png = renderFallbackPng(board, { maxWidth: 600 });
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 600);
  assert.equal(png.readUInt32BE(20), 400);
  assert.ok(png.includes(Buffer.from('IDAT', 'ascii')));
  assert.ok(png.includes(Buffer.from('IEND', 'ascii')));
});
