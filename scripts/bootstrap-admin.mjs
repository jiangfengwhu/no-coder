import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = new URL('../.dev.vars', import.meta.url);
const previous = await readFile(file, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
const existing = previous.match(/^QUEUE_ADMIN_TOKEN=([^\r\n]+)$/m)?.[1];
const token = existing || randomBytes(32).toString('hex');
if (!existing) await writeFile(file, `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}QUEUE_ADMIN_TOKEN=${token}\n`, { mode: 0o600 });

const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'put', 'QUEUE_ADMIN_TOKEN'], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
// Never print upstream output: even an unexpected prompt must not echo the secret.
child.stdout.resume();
child.stderr.resume();
child.stdin.end(`${token}\n`);
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
if (code !== 0) throw new Error('Admin secret upload failed. The key is retained in the ignored .dev.vars file; retry npm run setup:admin.');
console.log('Admin secret configured on Cloudflare. Read the local ignored .dev.vars file when using the management dialog.');
