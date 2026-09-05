import { spawn } from 'node:child_process';
const children = [spawn(process.execPath, ['--env-file-if-exists=.env', 'bridge/server.mjs'], { stdio: 'inherit' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })];
let stopping = false;
function stop() { if (stopping) return; stopping = true; children.forEach(child => child.kill('SIGTERM')); }
children.forEach(child => child.on('exit', code => { process.exitCode ||= code || 0; stop(); }));
process.on('SIGINT', stop); process.on('SIGTERM', stop);
