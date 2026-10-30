import { spawn } from 'node:child_process';

const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// shell is required for npm.cmd on Windows; arguments here are fixed literals.
const children = ['dev:backend', 'dev:frontend'].map(script => spawn(executable, ['run', script], {
  stdio: 'inherit', shell: process.platform === 'win32',
}));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
for (const child of children) child.on('exit', code => stop(code ?? 1));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
