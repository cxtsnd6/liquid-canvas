import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

class McpTestClient {
  constructor(dataDir) {
    this.proc = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs'), '--data-dir', dataDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    this.nextId = 1;
    this.pending = new Map();
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  close() {
    this.proc.kill();
  }
}

test('MCP stdio server full protocol, UI metadata, and agent+user collaborative flow', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lc-mcp-test-'));
  const client = new McpTestClient(dataDir);
  try {
    // 1. Initialize handshake
    const init = await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
      clientInfo: { name: 'test-host', version: '1.0.0' },
    });
    assert.equal(init.protocolVersion, '2025-03-26');
    assert.ok(init.capabilities.resources);
    assert.ok(init.capabilities.tools);
    client.notify('notifications/initialized', {});
    await client.request('ping', {});

    // 2. Tools list & Antigravity UI metadata
    const { tools } = await client.request('tools/list', {});
    const openTool = tools.find((t) => t.name === 'open_canvas');
    assert.equal(openTool._meta.ui.resourceUri, 'ui://liquid-canvas/board.html');
    assert.deepEqual(
      openTool._meta['com.google.antigravity/ui'].entrypoints.map((e) => e.type),
      ['aux_pane', 'global'],
    );
    const fileTool = tools.find((t) => t.name === 'open_canvas_file');
    assert.deepEqual(fileTool._meta['com.google.antigravity/ui'].entrypoints[0].extensions, ['.lcanvas']);

    const appSyncTool = tools.find((t) => t.name === 'app_sync');
    assert.deepEqual(appSyncTool._meta.ui.visibility, ['app']);

    // 3. Resources list & UI HTML syntax verification
    const { resources } = await client.request('resources/list', {});
    assert.ok(resources.some((r) => r.uri === 'ui://liquid-canvas/board.html'));
    const uiRes = await client.request('resources/read', { uri: 'ui://liquid-canvas/board.html' });
    const uiContent = uiRes.contents[0];
    assert.equal(uiContent.mimeType, 'text/html;profile=mcp-app');
    assert.equal(uiContent._meta.ui.prefersBorder, false);
    assert.ok(uiContent.text.length > 20000);
    assert.ok(uiContent.text.includes('applyHostStyleVariables'));

    // Extract inline script and verify it passes JS syntax check cleanly
    const scriptMatch = uiContent.text.match(/<script type="module">([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch);
    const tmpJs = join(dataDir, 'ui-check.mjs');
    writeFileSync(tmpJs, scriptMatch[1], 'utf8');
    await new Promise((res, rej) => {
      const chk = spawn(process.execPath, ['--check', tmpJs], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      chk.on('exit', (code) => (code === 0 ? res() : rej(new Error(`node --check exited ${code}`))));
    });

    // 4. Collaborative drawing flow: Agent draws -> UI syncs -> User draws -> Agent inspects & modifies
    const opened = await client.request('tools/call', { name: 'open_canvas', arguments: {} });
    assert.equal(opened.structuredContent.board.id, 'main');
    const rev0 = opened.structuredContent.board.revision;

    await client.request('tools/call', {
      name: 'draw_elements',
      arguments: {
        elements: [
          { id: 'card-1', type: 'rect', x: 100, y: 120, w: 220, h: 120, glass: true, stroke: '#38bdf8' },
          { id: 'lbl-1', type: 'text', x: 130, y: 165, text: 'Auth Service', color: '#ffffff' },
        ],
      },
    });

    // UI polls app_sync with old revision -> gets updated board
    const sync1 = await client.request('tools/call', {
      name: 'app_sync',
      arguments: { boardId: 'main', sinceRevision: rev0 },
    });
    assert.equal(sync1.structuredContent.changed, true);
    assert.equal(sync1.structuredContent.board.elements.length, 2);

    // UI polls again at current revision -> unchanged
    const sync2 = await client.request('tools/call', {
      name: 'app_sync',
      arguments: { boardId: 'main', sinceRevision: sync1.structuredContent.board.revision },
    });
    assert.equal(sync2.structuredContent.changed, false);

    // User draws a freehand stroke via app_mutate
    const mut = await client.request('tools/call', {
      name: 'app_mutate',
      arguments: {
        boardId: 'main',
        ops: [{
          op: 'add',
          elements: [{ id: 'user-sketch', type: 'freehand', points: [{ x: 400, y: 200 }, { x: 520, y: 240 }], stroke: '#f43f5e', strokeWidth: 5 }],
        }],
      },
    });
    assert.equal(mut.structuredContent.ok, true);
    assert.equal(mut.structuredContent.board.elements.length, 3);

    // Agent calls get_canvas -> sees both agent & user elements + valid PNG image
    const inspected = await client.request('tools/call', { name: 'get_canvas', arguments: {} });
    assert.ok(inspected.content[0].text.includes('user-sketch'));
    assert.ok(inspected.content[0].text.includes('card-1'));
    const imgBlock = inspected.content.find((c) => c.type === 'image');
    assert.ok(imgBlock);
    assert.equal(imgBlock.mimeType, 'image/png');
    assert.equal(Buffer.from(imgBlock.data, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

    // Agent modifies user's sketch & agent's card
    await client.request('tools/call', {
      name: 'update_elements',
      arguments: { updates: [{ id: 'card-1', dx: 40 }, { id: 'user-sketch', stroke: '#34d399' }] },
    });

    const svgRes = await client.request('resources/read', { uri: 'canvas://current/export.svg' });
    assert.ok(svgRes.contents[0].text.includes('Auth Service'));
    assert.ok(svgRes.contents[0].text.includes('#34d399'));
  } finally {
    client.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
