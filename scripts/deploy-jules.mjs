import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function deploymentOptions(env, args = []) {
  const dryRun = args.includes('--dry-run');
  const localAuth = args.includes('--local-auth');
  if (args.some(arg => !['--dry-run', '--local-auth'].includes(arg))) throw new Error('Supported options: --dry-run, --local-auth');
  if (!dryRun && !localAuth && !env.CLOUDFLARE_API_TOKEN && !(env.NC_DEPLOY_TOKEN && env.NC_JOB_ID)) throw new Error('Missing task authorization for the Worker credential broker (or CLOUDFLARE_API_TOKEN for manual use).');
  const appUrl = new URL(env.APP_URL || 'https://nocoder.297782.xyz');
  if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password || appUrl.search || appUrl.hash || appUrl.pathname !== '/') {
    throw new Error('APP_URL must be the HTTPS origin of the production Worker.');
  }
  const jobId = env.NC_JOB_ID || '';
  if (jobId && !/^[a-f0-9-]{36}$/.test(jobId)) throw new Error('NC_JOB_ID must be the queue task UUID.');
  return { dryRun, localAuth, appUrl: appUrl.origin, jobId, accountId: env.CLOUDFLARE_ACCOUNT_ID || '9f38af437152e2268766afd8fdb6cf72' };
}

export async function verifyLive(appUrl, expected, fetcher = fetch) {
  const response = await fetcher(`${appUrl}/api/health?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return false;
  const health = await response.json();
  return health.ok === true && health.commit === expected.commit && health.tree === expected.tree && health.jobId === expected.jobId;
}

async function main() {
  const options = deploymentOptions(process.env, process.argv.slice(2));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git('status', '--porcelain')) throw new Error('Commit all source changes before deploying. The working tree must be clean.');
  const commit = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: options.accountId, CI: 'true' };
  if (!options.dryRun && !options.localAuth && process.env.NC_DEPLOY_TOKEN) {
    const response = await fetch('https://nocoder-lab.809740942.workers.dev/api/deploy/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NC_DEPLOY_TOKEN}` },
      body: JSON.stringify({ jobId: options.jobId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Worker refused deployment credentials (HTTP ${response.status}). Check the active task and Worker Secrets.`);
    const credentials = await response.json();
    if (typeof credentials.apiToken !== 'string' || !credentials.apiToken || /^REPLACE_/i.test(credentials.apiToken)) throw new Error('Cloudflare deployment Secret has not been configured on the Worker.');
    env.CLOUDFLARE_API_TOKEN = credentials.apiToken;
    // The credential is only held in process memory and passed to Wrangler's environment.
  }
  async function run(executable, args) {
    const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    if (code !== 0) throw new Error(`Build or deployment command failed (exit ${code}).`);
  }
  const node = (...args) => run(process.execPath, args);
  async function assertLease() {
    if (!options.jobId) return;
    const response = await fetch(`${options.appUrl}/api/queue`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Cannot confirm the active queue task.');
    const queue = await response.json();
    if (queue.activeId !== options.jobId || queue.paused) throw new Error('This Jules task no longer owns the active queue slot, or the queue is paused.');
  }
  if (!options.dryRun) await assertLease();
  console.log('1/4 Typecheck and tests');
  await node('node_modules/typescript/bin/tsc', '--noEmit');
  await node('node_modules/vitest/vitest.mjs', 'run');
  console.log('2/4 Build frontend/ into dist/');
  await node('node_modules/vite/bin/vite.js', 'build');
  if (git('status', '--porcelain')) throw new Error('Build changed tracked source files. Commit and rerun before publishing.');
  const vars = ['--var', `APP_COMMIT:${commit}`, '--var', `APP_TREE:${tree}`, '--var', `APP_JOB:${options.jobId}`];
  console.log('3/4 Package backend/ and frontend assets with Wrangler');
  await node('node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', '.worker-build', ...vars);
  if (options.dryRun) {
    console.log('Packaging verified. Nothing was uploaded. Run npm run deploy:jules with the Cloudflare token to publish.');
    return;
  }
  await assertLease();
  console.log('4/4 Upload Worker and frontend assets to Cloudflare');
  await node('node_modules/wrangler/bin/wrangler.js', 'deploy', '--keep-vars', ...vars);
  const expected = { commit, tree, jobId: options.jobId };
  let verified = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    try { if (await verifyLive(options.appUrl, expected)) { verified = true; break; } } catch { /* allow deployment propagation */ }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!verified) throw new Error('Upload finished, but the live version was not confirmed. Report this in Jules; do not claim a successful deployment.');
  await mkdir(new URL('../.worker-build/', import.meta.url), { recursive: true });
  await writeFile(new URL('../.worker-build/deployment.json', import.meta.url), JSON.stringify({ ...expected, url: options.appUrl, verifiedAt: new Date().toISOString() }, null, 2));
  console.log(`Verified deployment: ${options.appUrl}\nCommit: ${commit}\nTree: ${tree}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
