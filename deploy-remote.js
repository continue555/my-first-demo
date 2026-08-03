const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = process.env.SSH_HOST || '42.194.139.7';
const USER = process.env.SSH_USER || 'ubuntu';
const BASE = '/opt/blowing-machine';
const PASSWORD = process.env.SSH_PASS;

if (!PASSWORD) {
  console.error('SSH_PASS is required');
  process.exit(1);
}

const conn = new Client();

function run(cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('close', code => resolve({ code, out, errOut }))
        .on('data', data => out += data.toString())
        .stderr.on('data', data => errOut += data.toString());
    });
  });
}

conn.on('ready', () => {
  conn.sftp(async (err, sftp) => {
    if (err) throw err;

    const put = (local, remote) => new Promise((resolve, reject) => {
      sftp.fastPut(local, remote, e => e ? reject(e) : resolve());
    });

    const mkdir = remote => new Promise((resolve, reject) => {
      sftp.mkdir(remote, e => {
        if (e && e.code !== 4) return reject(e);
        resolve();
      });
    });

    async function uploadDir(localDir, remoteDir) {
      await mkdir(remoteDir);
      const entries = fs.readdirSync(localDir, { withFileTypes: true });
      for (const entry of entries) {
        const localPath = path.join(localDir, entry.name);
        const remotePath = `${remoteDir}/${entry.name}`;
        if (entry.isDirectory()) await uploadDir(localPath, remotePath);
        else await put(localPath, remotePath);
      }
    }

    try {
      const root = process.cwd();
      await run(`mkdir -p ${BASE}/releases && cd ${BASE} && tar --exclude=node_modules --exclude=uploads --exclude=releases --exclude=.env --exclude=.git --exclude=.npm-cache --exclude=server_output.log -cf releases/pre-upload-$(date +%Y%m%d%H%M%S).tar .`);
      await uploadDir(path.join(root, 'public'), `${BASE}/public`);
      await uploadDir(path.join(root, 'frontend', 'src'), `${BASE}/frontend/src`);
      await uploadDir(path.join(root, 'migrations'), `${BASE}/migrations`);
      await mkdir(`${BASE}/services`);
      await mkdir(`${BASE}/scripts`);
      const files = [
        ['frontend/index.html', `${BASE}/frontend/index.html`],
        ['frontend/package.json', `${BASE}/frontend/package.json`],
        ['frontend/package-lock.json', `${BASE}/frontend/package-lock.json`],
        ['frontend/vite.config.js', `${BASE}/frontend/vite.config.js`],
        ['public/index.html', `${BASE}/public/index.html`],
        ['server.js', `${BASE}/server.js`],
        ['database.js', `${BASE}/database.js`],
        ['ecosystem.config.js', `${BASE}/ecosystem.config.js`],
        ['package.json', `${BASE}/package.json`],
        ['package-lock.json', `${BASE}/package-lock.json`],
        ['backup.js', `${BASE}/backup.js`],
        ['backup-cron.sh', `${BASE}/backup-cron.sh`],
        ['check_db.js', `${BASE}/check_db.js`],
        ['check_order.js', `${BASE}/check_order.js`],
        ['migrate_stages.js', `${BASE}/migrate_stages.js`],
        ['migrate_to_pg.js', `${BASE}/migrate_to_pg.js`],
        ['test-api.js', `${BASE}/test-api.js`],
        ['routes/auth.js', `${BASE}/routes/auth.js`],
        ['routes/audit.js', `${BASE}/routes/audit.js`],
        ['routes/departments.js', `${BASE}/routes/departments.js`],
        ['routes/export.js', `${BASE}/routes/export.js`],
        ['routes/notifications.js', `${BASE}/routes/notifications.js`],
        ['routes/orders-files.js', `${BASE}/routes/orders-files.js`],
        ['routes/orders.js', `${BASE}/routes/orders.js`],
        ['services/order-service.js', `${BASE}/services/order-service.js`],
        ['services/audit-service.js', `${BASE}/services/audit-service.js`],
        ['services/notifications-service.js', `${BASE}/services/notifications-service.js`],
        ['middleware/async-handler.js', `${BASE}/middleware/async-handler.js`],
        ['middleware/auth.js', `${BASE}/middleware/auth.js`],
        ['middleware/csrf.js', `${BASE}/middleware/csrf.js`],
        ['lib/sanitize.js', `${BASE}/lib/sanitize.js`],
        ['lib/overdue.js', `${BASE}/lib/overdue.js`],
        ['lib/file-permissions.js', `${BASE}/lib/file-permissions.js`],
        ['lib/dept-filter.js', `${BASE}/lib/dept-filter.js`],
        ['lib/stage-permissions.js', `${BASE}/lib/stage-permissions.js`],
        ['lib/validators.js', `${BASE}/lib/validators.js`],
        ['lib/cookies.js', `${BASE}/lib/cookies.js`],
        ['lib/download-ticket.js', `${BASE}/lib/download-ticket.js`],
        ['lib/stale-asset-map.json', `${BASE}/lib/stale-asset-map.json`],
        ['shared/stage-defs.json', `${BASE}/shared/stage-defs.json`],
        ['shared/status-labels.json', `${BASE}/shared/status-labels.json`],
        ['shared/role-labels.json', `${BASE}/shared/role-labels.json`],
        ['scripts/restore-drill.sh', `${BASE}/scripts/restore-drill.sh`],
        ['scripts/health-check.sh', `${BASE}/scripts/health-check.sh`],
        ['scripts/install-crons.sh', `${BASE}/scripts/install-crons.sh`],
        ['scripts/log-query.sh', `${BASE}/scripts/log-query.sh`],
        ['deploy/deploy.sh', `${BASE}/deploy/deploy.sh`],
        ['deploy/server-deploy.sh', `${BASE}/deploy/server-deploy.sh`],
        ['deploy/rollback.sh', `${BASE}/deploy/rollback.sh`],
        ['deploy/nginx.conf', `${BASE}/deploy/nginx.conf`],
        ['deploy/nginx-http.conf', `${BASE}/deploy/nginx-http.conf`],
        ['deploy/blowing-machine-https.conf', `${BASE}/deploy/blowing-machine-https.conf`],
        ['.env.example', `${BASE}/.env.example`]
      ];
      for (const [local, remote] of files) {
        await put(path.join(root, local), remote);
      }

      console.log('uploads done');

      const installFlag = process.env.DEPLOY_INSTALL ? ' --install' : '';
      const deploy = await run(`cd ${BASE} && bash deploy/server-deploy.sh${installFlag}`);
      console.log('server-deploy code:', deploy.code);
      console.log(deploy.out);
      if (deploy.errOut.trim()) console.log('server-deploy stderr:', deploy.errOut.trim());

      conn.end();
      process.exit(deploy.code || 0);
    } catch (e) {
      console.error('DEPLOY_ERROR', e.stack || e.message);
      conn.end();
      process.exit(1);
    }
  });
});

conn.connect({
  host: HOST,
  username: USER,
  password: PASSWORD,
  readyTimeout: 20000
});
