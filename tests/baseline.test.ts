import { describe, expect, it } from 'vitest';
import { compareWithBaseline } from '../server/modify.ts';
import type { TestRun } from '../shared/types.ts';

const run = (command: string, ok: boolean): TestRun => ({
  command, ok, exitCode: ok ? 0 : 1, outputTail: '', durationMs: 100,
});

describe('测试基线对比：区分本来就挂 vs 新增失败', () => {
  it('基线里通过、现在失败 → 新增失败', () => {
    const result = compareWithBaseline(
      [{ command: 'npm run build', ok: true }],
      [run('npm run build', false)],
    );
    expect(result[0].newFailure).toBe(true);
  });

  it('基线里就失败、现在也失败 → 不是新增失败（本来就挂）', () => {
    const result = compareWithBaseline(
      [{ command: 'npm run build', ok: false }],
      [run('npm run build', false)],
    );
    expect(result[0].newFailure).toBe(false);
  });

  it('现在通过 → 无论基线如何都不算新增失败', () => {
    const result = compareWithBaseline(
      [{ command: 'npm run build', ok: false }],
      [run('npm run build', true)],
    );
    expect(result[0].newFailure).toBe(false);
  });

  it('基线里没有这条命令、现在失败 → 视为新增失败（保守侧）', () => {
    const result = compareWithBaseline(
      [{ command: 'npm test', ok: true }],
      [run('npm run build', false)],
    );
    expect(result[0].newFailure).toBe(true);
  });

  it('没有基线（null）→ newFailure 全部 undefined（无从判断）', () => {
    const result = compareWithBaseline(null, [run('npm run build', false)]);
    expect(result[0].newFailure).toBeUndefined();
  });
});
