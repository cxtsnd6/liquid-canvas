import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const templatePath = join(ROOT, 'ui', 'src', 'board-template.html');
const sdkPath = join(ROOT, 'ui', 'vendor', 'ext-apps-bundle.mjs');
const outPath = join(ROOT, 'dist', 'board.html');

const template = readFileSync(templatePath, 'utf8');
let sdkRaw = readFileSync(sdkPath, 'utf8');

// Escape accidental closing script sequences if any ever appeared in future bundles
sdkRaw = sdkRaw.replace(/<\/script/gi, '<\\/script');

const exportMatch = sdkRaw.match(/export\s*\{([^}]+)\}\s*;?\s*$/);
if (!exportMatch) {
  throw new Error('Could not locate trailing export block in ext-apps-bundle.mjs');
}

const body = sdkRaw.slice(0, exportMatch.index);
const mappings = exportMatch[1]
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => {
    const m = item.match(/^(.+?)\s+as\s+(.+?)$/);
    return m ? `${m[2].trim()}: ${m[1].trim()}` : `${item}: ${item}`;
  });

const wrappedSdk = [
  'const { App, applyDocumentTheme, applyHostStyleVariables, getDocumentTheme } = (() => {',
  body,
  `return { ${mappings.join(', ')} };`,
  '})();',
].join('\n');

const marker = '/* __EXT_APPS_SDK__ */';
if (!template.includes(marker)) {
  throw new Error(`Template missing ${marker}`);
}

const html = template.replace(marker, () => wrappedSdk);
const bytes = Buffer.byteLength(html, 'utf8');
if (bytes > 9.5 * 1024 * 1024) {
  throw new Error(`Built HTML exceeds safe size budget: ${bytes} bytes`);
}

// Verify inline script syntax parses cleanly as ESM
const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  throw new Error('Could not find inline <script type="module"> in built HTML');
}
const { SourceTextModule } = await import('node:vm');
if (typeof SourceTextModule === 'function') {
  new SourceTextModule(scriptMatch[1]);
} else {
  new Function(scriptMatch[1]);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log(`Built ${outPath} (${(bytes / 1024).toFixed(1)} KB)`);
