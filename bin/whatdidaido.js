#!/usr/bin/env node
// whatdidaido 一键启动：必要时先构建前端，然后以生产模式起服务
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'client', 'dist');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.log('📦 首次运行，正在构建前端界面（约半分钟）…');
  const build = spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit', shell: true });
  if (build.status !== 0) {
    console.error('前端构建失败，请检查上面的报错。');
    process.exit(1);
  }
}

console.log('🗺️  whatdidaido 启动中…');
const child = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_ENV: 'production' },
});
child.on('close', code => process.exit(code ?? 0));
