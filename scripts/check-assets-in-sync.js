const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MAP_FILE = path.join(ROOT, 'lib', 'stale-asset-map.json');
const HTML_FILE = path.join(ROOT, 'public', 'index.html');
const ASSET_DIR = path.join(ROOT, 'public', 'assets');

const CHUNKS = ['AuditLog', 'Dashboard', 'Export', 'Layout', 'Login', 'Notifications', 'OrderDetail', 'Orders', 'Users', 'index', 'vendor', 'docx-preview', 'navigation', 'role-labels'];

function buildExpectedMap() {
  const oldMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const assets = fs.readdirSync(ASSET_DIR).filter(f => fs.statSync(path.join(ASSET_DIR, f)).isFile());
  const assetSet = new Set(assets);
  const entryJs = html.match(/\/assets\/(index-[^"]+\.js)/)?.[1];
  const entryCss = html.match(/\/assets\/(index-[^"]+\.css)/)?.[1];

  function prefixOf(name) {
    const matches = CHUNKS.filter(c => name.startsWith(c + '-'));
    matches.sort((a, b) => b.length - a.length);
    return matches[0] || null;
  }

  function currentFor(name) {
    const ext = path.extname(name);
    const prefix = prefixOf(name);
    if (!prefix) return null;
    if (prefix === 'index') return ext === '.js' ? entryJs : (ext === '.css' ? entryCss : null);
    const candidates = assets.filter(f => f.startsWith(prefix + '-') && f.endsWith(ext));
    return candidates[0] || null;
  }

  const map = {};
  const setIfAbsent = (k, v) => { if (v && !(k in map)) map[k] = v; };

  for (const [key, target] of Object.entries(oldMap)) {
    const next = assetSet.has(target) ? target : currentFor(target);
    if (!next) throw new Error(`cannot resolve stale target: ${key} -> ${target}`);
    setIfAbsent(key, next);
    if (!assetSet.has(target)) setIfAbsent(target, next);
  }

  const tracked = cp.execSync('git ls-files public/assets', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean).map(s => path.basename(s));
  for (const old of tracked) {
    if (assetSet.has(old) || (old in map)) continue;
    const next = currentFor(old);
    if (!next) throw new Error(`cannot resolve deleted tracked asset: ${old}`);
    map[old] = next;
  }

  const out = {};
  for (const k of Object.keys(map).sort()) out[k] = map[k];
  return { out, assetSet };
}

try {
  const { out, assetSet } = buildExpectedMap();
  const missingTargets = Object.values(out).filter(v => !assetSet.has(v));
  if (missingTargets.length > 0) {
    console.error('stale-asset-map.json 指向不存在的资源:');
    for (const t of missingTargets) console.error('  - ' + t);
    process.exit(1);
  }

  const expected = JSON.stringify(out, null, 2) + '\n';
  const actual = fs.readFileSync(MAP_FILE, 'utf8');
  if (expected !== actual) {
    console.error('stale-asset-map.json 与 public/assets 不同步。');
    console.error('请先执行 npm run build，再重新生成映射并提交 public/ 与 lib/stale-asset-map.json。');
    process.exit(1);
  }
  console.log('assets in sync OK (' + Object.keys(out).length + ' entries)');
} catch (e) {
  console.error('asset sync check failed:', e.message);
  process.exit(1);
}
