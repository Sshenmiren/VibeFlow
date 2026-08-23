import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// spawn/spawnSync 必须 mock，绝不真起服务/浏览器（vi.hoisted 保证在 mock 工厂前初始化）
const { spawn, spawnSync } = vi.hoisted(() => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));
vi.mock('node:child_process', () => ({ spawn, spawnSync }));

import { openWebui } from '../server/mcp-tools.ts';

let projDir: string;
const fetchMock = vi.fn();

beforeEach(() => {
  projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdad-openwebui-'));
  spawn.mockClear();
  spawnSync.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(projDir, { recursive: true, force: true });
});

const okJson = (data: unknown) => ({ ok: true, json: async () => data });

describe('openWebui', () => {
  it('服务已在跑时：不重复起服务，导入后返回 ?open=<id> 深链', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson([]))                              // /api/registry 探测：在跑
      .mockResolvedValueOnce(okJson({ id: 'abc123', name: 'proj' })); // /api/projects 导入

    const r = await openWebui(projDir);

    expect(spawn).not.toHaveBeenCalledWith('npx', ['tsx', 'server/index.ts'], expect.anything());
    expect(r.startedServer).toBe(false);
    expect(r.url).toBe('http://127.0.0.1:5177/?open=abc123');
    expect(r.name).toBe('proj');
    // 浏览器仍会被打开（spawn 调用一次用于 open）
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('服务未在跑时：detached 起服务，就绪后导入', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('conn refused'))  // 首次探测：没跑
      .mockResolvedValueOnce(okJson([]))                 // 轮询：起来了
      .mockResolvedValueOnce(okJson([]))                 // 起来后再次确认
      .mockResolvedValueOnce(okJson({ id: 'def456', name: 'p2' })); // 导入

    const r = await openWebui(projDir);

    expect(spawn).toHaveBeenCalledWith('npx', ['tsx', 'server/index.ts'], expect.objectContaining({ detached: true }));
    expect(r.startedServer).toBe(true);
    expect(r.url).toBe('http://127.0.0.1:5177/?open=def456');
  });

  it('路径不是文件夹时报错', async () => {
    await expect(openWebui(path.join(projDir, 'nope'))).rejects.toThrow(/不存在或不是文件夹/);
  });
});
