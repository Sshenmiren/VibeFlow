/** 真实端到端：流式直播修改 → 基线对比 → 继续调整 → 回滚。用法：npx tsx scripts/e2e-stream-modify.ts */
const BASE = 'http://localhost:5177';
const PID = '86e213dc4a62'; // LLMengine

// ---- SSE 订阅（原生 fetch 流） ----
const logLines: string[] = [];
let latestCs: Record<string, unknown> | null = null;
const controller = new AbortController();
void (async () => {
  const res = await fetch(`${BASE}/api/projects/${PID}/events`, { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const data = part.split('\n').find(l => l.startsWith('data: '))?.slice(6);
      if (!data) continue;
      try {
        const e = JSON.parse(data);
        if (e.type === 'modify:log') { logLines.push(e.line); console.log('  [直播]', e.line); }
        if (e.type === 'changeset') latestCs = e.changeSet;
      } catch { /* ignore */ }
    }
  }
})().catch(() => { /* aborted */ });

const post = (url: string, body?: unknown) =>
  fetch(`${BASE}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());

const waitStatus = async (want: string[], timeoutSec = 600): Promise<Record<string, unknown>> => {
  for (let i = 0; i < timeoutSec; i += 3) {
    await new Promise(r => setTimeout(r, 3000));
    const s = latestCs?.status as string;
    if (s && want.includes(s)) return latestCs!;
    if (s === 'failed') throw new Error('执行失败: ' + latestCs?.error);
  }
  throw new Error('等待超时，当前状态: ' + latestCs?.status);
};

// 1. 创建修改单
const cs = await post(`/api/projects/${PID}/nodes/${encodeURIComponent('journey:main_menu')}/modify`, {
  instruction: '把主菜单副标题文字末尾加一个感叹号',
}) as { id: string };
console.log('① 修改单已创建:', cs.id);

// 2. 执行（流式直播）
await post(`/api/projects/${PID}/changesets/${cs.id}/execute`);
console.log('② 执行中（应看到实时直播行）…');
let done = await waitStatus(['tested']);
console.log(`③ 完成。直播行数: ${logLines.length}`);
const tests = done.tests as { command: string; ok: boolean; newFailure?: boolean }[];
for (const t of tests) console.log('  测试:', t.ok ? 'PASS' : 'FAIL', t.command, '| newFailure:', t.newFailure);
const preExistingOk = tests.filter(t => !t.ok).every(t => t.newFailure === false);
console.log(preExistingOk ? '④ ✅ 基线对比正确：既有失败被标记为"不怪这次"' : '④ ❌ 基线标记不对');
console.log('  sessionId 已存:', Boolean(done.sessionId));

// 3. 继续调整（同会话 resume）
const logCountBefore = logLines.length;
await post(`/api/projects/${PID}/changesets/${cs.id}/refine`, { instruction: '把感叹号换成三个点（省略号）' });
console.log('⑤ 继续调整中…');
done = await waitStatus(['tested']);
const diffText = String(done.diff ?? '');
console.log('⑥ 调整完成。新增直播行:', logLines.length - logCountBefore, '| diff 包含省略号改动:', /\.\.\.|…/.test(diffText));
console.log('  refinements:', JSON.stringify(done.refinements));

// 4. 回滚，保持屎山原样
await post(`/api/projects/${PID}/changesets/${cs.id}/rollback`);
console.log('⑦ 已回滚 ✓');
controller.abort();
process.exit(0);
