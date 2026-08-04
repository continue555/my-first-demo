const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEPLOY_JS = path.join(ROOT, 'deploy-remote.js');

const deployJs = fs.readFileSync(DEPLOY_JS, 'utf8');
const listed = new Set();
const re = /\[\s*'([^']+)'\s*,\s*`/g;
let m;
while ((m = re.exec(deployJs))) {
  listed.add(m[1].replace(/\\/g, '/'));
}

function collect(dir) {
  const full = path.join(ROOT, dir);
  return fs.readdirSync(full, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => `${dir}/${e.name}`);
}

const required = [
  ...collect('services'),
  ...collect('routes'),
  ...collect('middleware'),
  ...collect('scripts'),
  ...collect('lib').filter(f => f.endsWith('.js') || f.endsWith('.json')),
  ...collect('shared').filter(f => f.endsWith('.json'))
];

const missing = required.filter(f => !listed.has(f));
if (missing.length > 0) {
  console.error('deploy-remote.js 上传清单缺少以下文件:');
  for (const f of missing) console.error('  - ' + f);
  process.exit(1);
}

console.log('deploy manifest OK (' + required.length + ' files covered)');
