import { spawn } from 'node:child_process';
const children = ['server', 'web'].map(workspace => spawn('npm', ['run', 'dev', '-w', workspace], { stdio: 'inherit' }));
for (const child of children) child.on('exit', code => { if (code) { children.forEach(c => c.kill()); process.exit(code); } });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { children.forEach(c => c.kill(signal)); });
