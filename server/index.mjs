import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { CanvasStore } from './store.mjs';
import { boardToSvg, renderFallbackPng } from './renderer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..');
const UI_RESOURCE_URI = 'ui://liquid-canvas/board.html';

function parseArgs(argv) {
  const opts = { dataDir: process.env.PLUGIN_DATA || join(PLUGIN_ROOT, '.data') };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--data-dir' || arg === '--data_dir') && argv[i + 1]) {
      opts.dataDir = argv[++i];
    } else if (arg.startsWith('--data-dir=') || arg.startsWith('--data_dir=')) {
      opts.dataDir = arg.split('=', 2)[1];
    }
  }
  return opts;
}

const OPTS = parseArgs(process.argv);
const store = new CanvasStore(OPTS.dataDir);

function loadUiHtml() {
  const candidates = [
    process.env.LIQUID_CANVAS_HTML,
    join(PLUGIN_ROOT, 'dist', 'board.html'),
    join(PLUGIN_ROOT, 'ui', 'src', 'board-template.html'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return '<!doctype html><html><body><p>Liquid Canvas UI bundle not found.</p></body></html>';
}

function buildStructuredBoardPayload(board) {
  const payload = {
    mode: 'live',
    activeBoardId: store.getActiveBoardId(),
    board,
    boards: store.listBoards(),
    canUndo: store.canUndo(board.id),
    canRedo: store.canRedo(board.id),
  };
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > 700 * 1024) {
    return {
      mode: 'live',
      deferred: true,
      activeBoardId: store.getActiveBoardId(),
      boardId: board.id,
      revision: board.revision,
    };
  }
  return payload;
}

function getPreviewPngBuffer(board, theme = 'dark') {
  return store.getFreshSnapshot(board.id) || renderFallbackPng(board, { maxWidth: 1000, theme });
}

const TOOLS = [
  {
    name: 'open_canvas',
    title: 'Liquid Canvas',
    description:
      'Open or refresh the interactive Liquid Canvas drawing board in the Antigravity side pane or full-page view. ' +
      'Optionally select/create a board or update canvas dimensions/background. Call with no arguments to open the active board.',
    inputSchema: {
      type: 'object',
      properties: {
        board_id: { type: 'string', description: 'Optional board ID to open or create (default: active board).' },
        title: { type: 'string', description: 'Optional board title when creating or renaming.' },
        width: { type: 'number', description: 'Optional canvas width in pixels (200-4096).' },
        height: { type: 'number', description: 'Optional canvas height in pixels (200-4096).' },
        background: { type: 'string', description: 'Optional background: "auto", "dark", "light", "transparent", or hex color.' },
      },
    },
    _meta: {
      ui: { resourceUri: UI_RESOURCE_URI },
      'com.google.antigravity/ui': {
        entrypoints: [
          { type: 'aux_pane', title: 'Liquid Canvas' },
          { type: 'global', title: 'Liquid Canvas' },
        ],
      },
    },
  },
  {
    name: 'open_canvas_file',
    title: 'Liquid Canvas File Viewer',
    description: 'View and edit .lcanvas drawing files.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            resourceUri: { type: 'string' },
          },
        },
      },
    },
    _meta: {
      ui: { resourceUri: UI_RESOURCE_URI },
      'com.google.antigravity/ui': {
        entrypoints: [
          { type: 'file', title: 'Liquid Canvas', extensions: ['.lcanvas'] },
        ],
      },
    },
  },
  {
    name: 'get_canvas',
    title: 'Inspect Canvas',
    description:
      'Inspect the current drawing board: returns element IDs, types, coordinates, layers, and a rendered PNG preview image so you can see both user strokes and agent shapes before modifying them.',
    inputSchema: {
      type: 'object',
      properties: {
        board_id: { type: 'string', description: 'Board ID (defaults to active board).' },
        include_image: { type: 'boolean', description: 'Whether to attach a rendered PNG image (default: true).' },
        include_elements: { type: 'boolean', description: 'Whether to list elements with coordinates and IDs (default: true).' },
      },
    },
  },
  {
    name: 'draw_elements',
    title: 'Draw on Canvas',
    description:
      'Add one or more vector/sketch elements to the canvas in a single batch. Supports rect (with optional radius, fillGradient, glass), ellipse, line, arrow (optional curved cx/cy & label), polygon/polyline, path (SVG path d), freehand (points array), text, and image.',
    inputSchema: {
      type: 'object',
      required: ['elements'],
      properties: {
        board_id: { type: 'string', description: 'Target board ID (defaults to active board).' },
        layer_id: { type: 'string', description: 'Optional target layer ID.' },
        replace_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of existing element IDs to remove before inserting new elements.',
        },
        elements: {
          type: 'array',
          description: 'Elements to draw. Supported types: rect, ellipse, line, arrow, polygon, path, freehand, text, image.',
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              id: { type: 'string', description: 'Optional semantic ID (replaces existing element if same ID exists).' },
              type: { type: 'string', enum: ['rect', 'ellipse', 'circle', 'line', 'arrow', 'polygon', 'polyline', 'path', 'freehand', 'stroke', 'text', 'image'] },
              layerId: { type: 'string' },
              label: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
              cx: { type: 'number' },
              cy: { type: 'number' },
              rx: { type: 'number' },
              ry: { type: 'number' },
              r: { type: 'number' },
              x1: { type: 'number' },
              y1: { type: 'number' },
              x2: { type: 'number' },
              y2: { type: 'number' },
              radius: { type: 'number' },
              fill: { type: 'string' },
              fillGradient: { type: 'object' },
              stroke: { type: 'string' },
              strokeWidth: { type: 'number' },
              dash: { type: 'array', items: { type: 'number' } },
              glass: { type: 'boolean', description: 'Render rect as frosted glass card on canvas.' },
              shadow: { type: 'boolean' },
              opacity: { type: 'number' },
              rotation: { type: 'number' },
              startArrow: { type: 'string', enum: ['none', 'arrow', 'dot'] },
              endArrow: { type: 'string', enum: ['none', 'arrow', 'dot'] },
              closed: { type: 'boolean' },
              smooth: { type: 'boolean' },
              brush: { type: 'string', enum: ['pen', 'marker', 'highlighter', 'glow'] },
              points: { type: 'array', items: { type: 'object' } },
              d: { type: 'string', description: 'SVG path string when type="path".' },
              scaleX: { type: 'number' },
              scaleY: { type: 'number' },
              text: { type: 'string' },
              fontSize: { type: 'number' },
              fontWeight: { type: 'string' },
              color: { type: 'string' },
              align: { type: 'string', enum: ['left', 'center', 'right'] },
              background: { type: 'string' },
              padding: { type: 'number' },
              src: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'update_elements',
    title: 'Modify Canvas Elements',
    description:
      'Modify existing elements by ID. Supports absolute properties (x, y, w, h, fill, stroke, text, fontSize, opacity, rotation, layerId) as well as relative translation (dx, dy), scale, bringToFront, and sendToBack.',
    inputSchema: {
      type: 'object',
      required: ['updates'],
      properties: {
        board_id: { type: 'string' },
        updates: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            additionalProperties: true,
            properties: {
              id: { type: 'string' },
              dx: { type: 'number' },
              dy: { type: 'number' },
              scale: { type: 'number' },
              bringToFront: { type: 'boolean' },
              sendToBack: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
  {
    name: 'delete_elements',
    title: 'Delete Canvas Elements',
    description: 'Delete one or more elements from the board by their IDs.',
    inputSchema: {
      type: 'object',
      required: ['ids'],
      properties: {
        board_id: { type: 'string' },
        ids: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'manage_layers',
    title: 'Manage Layers',
    description: 'List, create, update (rename/show/hide/lock/opacity), activate, delete, or reorder layers on a board.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        board_id: { type: 'string' },
        action: { type: 'string', enum: ['list', 'create', 'update', 'activate', 'delete', 'reorder'] },
        layer_id: { type: 'string' },
        name: { type: 'string' },
        visible: { type: 'boolean' },
        locked: { type: 'boolean' },
        opacity: { type: 'number' },
        activate: { type: 'boolean' },
        order: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'board_action',
    title: 'Board Action',
    description:
      'Perform board-level operations: clear, undo, redo, set_canvas (resize/background/grid/title), list_boards, create_board, switch_board, delete_board, export_svg, export_png.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['clear', 'undo', 'redo', 'set_canvas', 'list_boards', 'create_board', 'switch_board', 'delete_board', 'export_svg', 'export_png'],
        },
        board_id: { type: 'string' },
        layer_id: { type: 'string' },
        title: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        background: { type: 'string' },
        show_grid: { type: 'boolean' },
        output_path: { type: 'string', description: 'Optional file path to save exported SVG or PNG.' },
      },
    },
  },
  // App-only internal RPCs
  {
    name: 'app_sync',
    title: 'Sync Board',
    description: 'App-only sync check for live canvas updates.',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        sinceRevision: { type: 'number' },
      },
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'app_mutate',
    title: 'Mutate Board',
    description: 'App-only mutation batch from interactive canvas.',
    inputSchema: {
      type: 'object',
      required: ['ops'],
      properties: {
        boardId: { type: 'string' },
        ops: { type: 'array', items: { type: 'object' } },
        snapshotPngBase64: { type: 'string' },
      },
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'app_save_snapshot',
    title: 'Save Snapshot',
    description: 'App-only PNG snapshot upload.',
    inputSchema: {
      type: 'object',
      required: ['pngBase64'],
      properties: {
        boardId: { type: 'string' },
        revision: { type: 'number' },
        pngBase64: { type: 'string' },
      },
    },
    _meta: { ui: { visibility: ['app'] } },
  },
];

const RESOURCES = [
  {
    uri: UI_RESOURCE_URI,
    name: 'Liquid Canvas UI',
    description: 'Interactive Liquid Glass drawing board MCP App',
    mimeType: 'text/html;profile=mcp-app',
    _meta: { ui: { prefersBorder: false } },
  },
  {
    uri: 'canvas://current/preview.png',
    name: 'Current Canvas Preview (PNG)',
    description: 'Rendered PNG image of the currently active canvas board',
    mimeType: 'image/png',
  },
  {
    uri: 'canvas://current/scene.json',
    name: 'Current Canvas Scene (JSON)',
    description: 'Structured JSON scene graph of the active canvas board',
    mimeType: 'application/json',
  },
  {
    uri: 'canvas://current/export.svg',
    name: 'Current Canvas Export (SVG)',
    description: 'Scalable SVG vector export of the active canvas board',
    mimeType: 'image/svg+xml',
  },
];

function handleToolCall(name, args = {}) {
  switch (name) {
    case 'open_canvas': {
      let board = args.board_id ? store.switchBoard(args.board_id) : store.getOrCreateBoard();
      if (args.title !== undefined || args.width !== undefined || args.height !== undefined || args.background !== undefined) {
        board = store.setCanvasConfig(board.id, {
          title: args.title,
          width: args.width,
          height: args.height,
          background: args.background,
        }, 'agent');
      }
      return {
        content: [{ type: 'text', text: `Opened Liquid Canvas:\n${store.summarizeBoard(board, { includeElements: false })}` }],
        structuredContent: buildStructuredBoardPayload(board),
      };
    }

    case 'open_canvas_file': {
      const file = args.file || {};
      return {
        content: [{ type: 'text', text: `Opening Liquid Canvas file: ${file.name || 'untitled.lcanvas'}` }],
        structuredContent: {
          mode: 'file',
          file,
        },
      };
    }

    case 'get_canvas': {
      const board = store.getOrCreateBoard(args.board_id);
      const summary = store.summarizeBoard(board, { includeElements: args.include_elements !== false });
      const content = [{ type: 'text', text: summary }];
      if (args.include_image !== false) {
        const png = getPreviewPngBuffer(board);
        content.push({
          type: 'image',
          data: png.toString('base64'),
          mimeType: 'image/png',
        });
      }
      return {
        content,
        structuredContent: {
          boardId: board.id,
          revision: board.revision,
          width: board.width,
          height: board.height,
          elementCount: board.elements.length,
        },
      };
    }

    case 'draw_elements': {
      const elements = Array.isArray(args.elements) ? args.elements : [];
      const { board, created } = store.drawElements(args.board_id, elements, {
        author: 'agent',
        layerId: args.layer_id,
        replaceIds: args.replace_ids,
      });
      const ids = created.map((c) => c.id);
      return {
        content: [{
          type: 'text',
          text: `Drew ${created.length} element(s) on "${board.id}" (rev=${board.revision}): ${ids.join(', ')}`,
        }],
        structuredContent: {
          boardId: board.id,
          revision: board.revision,
          createdIds: ids,
          totalElements: board.elements.length,
        },
      };
    }

    case 'update_elements': {
      const updates = Array.isArray(args.updates) ? args.updates : [];
      const { board, updatedIds, missingIds } = store.updateElements(args.board_id, updates, { author: 'agent' });
      const msg = [`Updated ${updatedIds.length} element(s) on "${board.id}" (rev=${board.revision})`];
      if (updatedIds.length) msg.push(`updated: ${updatedIds.join(', ')}`);
      if (missingIds.length) msg.push(`not found: ${missingIds.join(', ')}`);
      return {
        content: [{ type: 'text', text: msg.join('; ') }],
        structuredContent: { boardId: board.id, revision: board.revision, updatedIds, missingIds },
      };
    }

    case 'delete_elements': {
      const ids = Array.isArray(args.ids) ? args.ids : [];
      const { board, deletedCount } = store.deleteElements(args.board_id, ids, { author: 'agent' });
      return {
        content: [{ type: 'text', text: `Deleted ${deletedCount} element(s) from "${board.id}" (rev=${board.revision}).` }],
        structuredContent: { boardId: board.id, revision: board.revision, deletedCount },
      };
    }

    case 'manage_layers': {
      const { board, layers } = store.manageLayers(args.board_id, {
        action: args.action,
        layerId: args.layer_id,
        name: args.name,
        visible: args.visible,
        locked: args.locked,
        opacity: args.opacity,
        activate: args.activate,
        order: args.order,
      }, 'agent');
      return {
        content: [{
          type: 'text',
          text: `Layers on "${board.id}" (active=${board.activeLayerId}):\n` +
            layers.map((l) => `- ${l.id}: "${l.name}" visible=${l.visible} locked=${l.locked} opacity=${l.opacity}`).join('\n'),
        }],
        structuredContent: { boardId: board.id, revision: board.revision, activeLayerId: board.activeLayerId, layers },
      };
    }

    case 'board_action': {
      const action = args.action;
      if (action === 'list_boards') {
        const list = store.listBoards();
        return {
          content: [{
            type: 'text',
            text: list.map((b) => `${b.active ? '* ' : '  '}${b.id} ("${b.title}") ${b.width}×${b.height} elements=${b.elementCount} rev=${b.revision}`).join('\n'),
          }],
          structuredContent: { boards: list, activeBoardId: store.getActiveBoardId() },
        };
      }
      if (action === 'create_board') {
        const b = store.createBoard(args.board_id, {
          title: args.title,
          width: args.width,
          height: args.height,
          background: args.background,
          activate: true,
        });
        return {
          content: [{ type: 'text', text: `Created and switched to board "${b.id}" (${b.width}×${b.height}).` }],
          structuredContent: { board: b, boards: store.listBoards() },
        };
      }
      if (action === 'switch_board') {
        const b = store.switchBoard(args.board_id);
        return {
          content: [{ type: 'text', text: `Switched active board to "${b.id}" (rev=${b.revision}).` }],
          structuredContent: { board: b, boards: store.listBoards() },
        };
      }
      if (action === 'delete_board') {
        const ok = store.deleteBoard(args.board_id);
        return {
          content: [{ type: 'text', text: ok ? `Deleted board "${args.board_id}".` : `Board "${args.board_id}" not found.` }],
          structuredContent: { deleted: ok, boards: store.listBoards() },
        };
      }
      if (action === 'clear') {
        const b = store.clearBoard(args.board_id, { layerId: args.layer_id, author: 'agent' });
        return {
          content: [{ type: 'text', text: `Cleared ${args.layer_id ? `layer "${args.layer_id}" on ` : ''}board "${b.id}" (rev=${b.revision}).` }],
          structuredContent: { boardId: b.id, revision: b.revision },
        };
      }
      if (action === 'undo') {
        const { board, changed } = store.undo(args.board_id, 'agent');
        return {
          content: [{ type: 'text', text: changed ? `Undid last change on "${board.id}" (rev=${board.revision}).` : 'Nothing to undo.' }],
          structuredContent: { boardId: board.id, revision: board.revision, changed },
        };
      }
      if (action === 'redo') {
        const { board, changed } = store.redo(args.board_id, 'agent');
        return {
          content: [{ type: 'text', text: changed ? `Redid change on "${board.id}" (rev=${board.revision}).` : 'Nothing to redo.' }],
          structuredContent: { boardId: board.id, revision: board.revision, changed },
        };
      }
      if (action === 'set_canvas') {
        const b = store.setCanvasConfig(args.board_id, {
          title: args.title,
          width: args.width,
          height: args.height,
          background: args.background,
          showGrid: args.show_grid,
        }, 'agent');
        return {
          content: [{ type: 'text', text: `Updated canvas config for "${b.id}": ${b.width}×${b.height}, bg="${b.background}", grid=${b.showGrid} (rev=${b.revision}).` }],
          structuredContent: { boardId: b.id, revision: b.revision },
        };
      }
      if (action === 'export_svg') {
        const b = store.getOrCreateBoard(args.board_id);
        const svg = boardToSvg(b);
        if (args.output_path) {
          const abs = resolve(args.output_path);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, svg, 'utf8');
          return {
            content: [{ type: 'text', text: `Exported SVG (${Buffer.byteLength(svg, 'utf8')} bytes) to ${abs}` }],
            structuredContent: { path: abs, bytes: Buffer.byteLength(svg, 'utf8') },
          };
        }
        return {
          content: [{ type: 'text', text: svg }],
          structuredContent: { svg },
        };
      }
      if (action === 'export_png') {
        const b = store.getOrCreateBoard(args.board_id);
        const png = getPreviewPngBuffer(b);
        if (args.output_path) {
          const abs = resolve(args.output_path);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, png);
          return {
            content: [{ type: 'text', text: `Exported PNG (${png.length} bytes) to ${abs}` }],
            structuredContent: { path: abs, bytes: png.length },
          };
        }
        return {
          content: [
            { type: 'text', text: `Rendered PNG for board "${b.id}" (${png.length} bytes).` },
            { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
          ],
        };
      }
      throw new Error(`Unsupported board_action: ${action}`);
    }

    case 'app_sync': {
      const targetId = args.boardId || store.getActiveBoardId();
      const board = store.getOrCreateBoard(targetId);
      const since = Number(args.sinceRevision);
      if (Number.isFinite(since) && since === board.revision && targetId === store.getActiveBoardId()) {
        return {
          content: [{ type: 'text', text: 'unchanged' }],
          structuredContent: {
            changed: false,
            revision: board.revision,
            activeBoardId: store.getActiveBoardId(),
          },
        };
      }
      return {
        content: [{ type: 'text', text: `sync rev=${board.revision}` }],
        structuredContent: {
          changed: true,
          activeBoardId: store.getActiveBoardId(),
          board,
          boards: store.listBoards(),
          canUndo: store.canUndo(board.id),
          canRedo: store.canRedo(board.id),
        },
      };
    }

    case 'app_mutate': {
      const board = store.applyAppOps(args.boardId || store.getActiveBoardId(), args.ops || []);
      if (args.snapshotPngBase64) {
        store.saveSnapshot(board.id, board.revision, args.snapshotPngBase64);
      }
      return {
        content: [{ type: 'text', text: `ok rev=${board.revision}` }],
        structuredContent: {
          ok: true,
          activeBoardId: store.getActiveBoardId(),
          board,
          boards: store.listBoards(),
          canUndo: store.canUndo(board.id),
          canRedo: store.canRedo(board.id),
        },
      };
    }

    case 'app_save_snapshot': {
      const targetId = args.boardId || store.getActiveBoardId();
      const ok = store.saveSnapshot(targetId, args.revision, args.pngBase64);
      return {
        content: [{ type: 'text', text: ok ? 'snapshot saved' : 'snapshot skipped' }],
        structuredContent: { ok },
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

function handleResourceRead(uri) {
  if (uri === UI_RESOURCE_URI) {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/html;profile=mcp-app',
          text: loadUiHtml(),
          _meta: { ui: { prefersBorder: false } },
        },
      ],
    };
  }
  if (uri === 'canvas://current/preview.png') {
    const board = store.getOrCreateBoard();
    const png = getPreviewPngBuffer(board);
    return {
      contents: [{ uri, mimeType: 'image/png', blob: png.toString('base64') }],
    };
  }
  if (uri === 'canvas://current/scene.json') {
    const board = store.getOrCreateBoard();
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(board, null, 2) }],
    };
  }
  if (uri === 'canvas://current/export.svg') {
    const board = store.getOrCreateBoard();
    return {
      contents: [{ uri, mimeType: 'image/svg+xml', text: boardToSvg(board) }],
    };
  }
  const err = new Error(`Resource not found: ${uri}`);
  err.code = -32002;
  throw err;
}

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function sendError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: err })}\n`);
}

const SUPPORTED_VERSIONS = new Set(['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  try {
    switch (method) {
      case 'initialize': {
        const reqVer = params?.protocolVersion;
        const protocolVersion = SUPPORTED_VERSIONS.has(reqVer) ? reqVer : '2025-03-26';
        sendResponse(id, {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: {
            name: 'liquid-canvas',
            version: '1.0.0',
          },
          instructions:
            'Liquid Canvas provides a shared collaborative drawing board for both the user and the agent. ' +
            'Call open_canvas to open or present the side-pane board, draw_elements / update_elements / delete_elements to draw or edit, and get_canvas to inspect both element IDs and a PNG image of what the user drew.',
        });
        break;
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        break;
      case 'ping':
        if (isRequest) sendResponse(id, {});
        break;
      case 'tools/list':
        if (isRequest) sendResponse(id, { tools: TOOLS });
        break;
      case 'tools/call': {
        const res = handleToolCall(params?.name, params?.arguments || {});
        if (isRequest) sendResponse(id, res);
        break;
      }
      case 'resources/list':
        if (isRequest) sendResponse(id, { resources: RESOURCES });
        break;
      case 'resources/templates/list':
        if (isRequest) sendResponse(id, { resourceTemplates: [] });
        break;
      case 'resources/read': {
        const res = handleResourceRead(params?.uri);
        if (isRequest) sendResponse(id, res);
        break;
      }
      default:
        if (isRequest) sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (isRequest) {
      if (method === 'tools/call') {
        sendResponse(id, {
          content: [{ type: 'text', text: `Error: ${err?.message || String(err)}` }],
          isError: true,
        });
      } else {
        sendError(id, err?.code || -32603, err?.message || String(err));
      }
    }
  }
}

export function startServer() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      handleMessage(msg);
    } catch (err) {
      sendError(null, -32700, `Parse error: ${err?.message || err}`);
    }
  });
}

// Run when executed directly
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  startServer();
}
