import { useState } from 'react';
import type { ChangeSet } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useApp } from '../store.ts';
import { DiffView } from './DiffView.tsx';

/** 修改单全生命周期展示：计划 → 执行 → diff → 测试 → 接受/回滚。节点修改和构建蓝图共用。 */
export function ChangeSetProgress({ projectId, cs, onReset }: { projectId: string; cs: ChangeSet; onReset?: () => void }) {
  const { updateChangeSet, showToast, refreshSettings, refreshAll } = useApp();
  const [busy, setBusy] = useState<string | null>(null);

  const execute = async () => {
    setBusy('execute');
    try {
      await api.executeChangeSet(projectId, cs.id); // 进度经 SSE 推送
    } catch (err) {
      const msg = (err as Error).message;
      showToast(msg === 'DIRTY_TREE' ? '项目里有未保存的改动。先点「保存快照」，再执行。' : msg, 'error');
    } finally { setBusy(null); }
  };

  const snapshot = async () => {
    setBusy('snapshot');
    try {
      await api.snapshot(projectId);
      showToast('已创建快照，现在可以执行了');
    } catch (err) { showToast((err as Error).message, 'error'); }
    finally { setBusy(null); }
  };

  const accept = async () => {
    setBusy('accept');
    try {
      const updated = await api.acceptChangeSet(projectId, cs.id);
      updateChangeSet(updated);
      void refreshSettings(); void refreshAll();
      showToast('修改已接受并保存 ✓');
    } catch (err) { showToast((err as Error).message, 'error'); }
    finally { setBusy(null); }
  };

  const rollback = async () => {
    setBusy('rollback');
    try {
      const updated = await api.rollbackChangeSet(projectId, cs.id);
      updateChangeSet(updated);
      void refreshAll();
      showToast('已回滚到修改前 ↩');
    } catch (err) { showToast((err as Error).message, 'error'); }
    finally { setBusy(null); }
  };

  return (
    <div className="fade-in">
      {cs.plan && (
        <>
          {cs.plan.files.length > 0 && (
            <>
              <div className="section-label">计划（将从这些文件入手）</div>
              <div>{cs.plan.files.map(f => <span key={f} className="chip mono">{f}</span>)}</div>
            </>
          )}
          <p style={{ fontSize: 12, color: 'var(--ink-2)' }}>{cs.plan.note}</p>
        </>
      )}

      {cs.status === 'planned' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="primary" onClick={() => void execute()} disabled={busy === 'execute'}>
            {busy === 'execute' ? <><span className="spin" /> 启动中…</> : '▶ 开始执行'}
          </button>
          <button onClick={() => void snapshot()} disabled={busy === 'snapshot'}>先保存快照</button>
          {onReset && <button className="ghost" onClick={onReset}>放弃</button>}
        </div>
      )}

      {cs.status === 'executing' && <p style={{ marginTop: 10 }}><span className="spin" /> AI 正在写代码…（可能需要几分钟，完成后自动显示改动）</p>}
      {cs.status === 'testing' && <p style={{ marginTop: 10 }}><span className="spin" /> 改动完成，正在运行测试和检查…</p>}

      {cs.status === 'failed' && (
        <div style={{ background: 'var(--cinnabar-soft)', borderRadius: 6, padding: 10, marginTop: 10, fontSize: 13 }}>
          ❌ 执行失败：{cs.error}
          <div style={{ marginTop: 6 }}>
            <button onClick={() => void rollback()} disabled={busy === 'rollback'}>清理现场</button>
            {onReset && <button className="ghost" onClick={onReset} style={{ marginLeft: 6 }}>重新来</button>}
          </div>
        </div>
      )}

      {(cs.status === 'diffed' || cs.status === 'tested') && cs.diff && (
        <>
          <div className="section-label">改了什么（{cs.changedFiles.length} 个文件）</div>
          <DiffView diff={cs.diff} />

          {cs.tests.length > 0 && (
            <>
              <div className="section-label">测试与检查</div>
              {cs.tests.map((t, i) => (
                <details key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                  <summary style={{ cursor: 'pointer' }}>
                    {t.ok ? '✅' : '❌'} <span className="mono">{t.command}</span>
                    <span style={{ color: 'var(--ink-3)' }}>（{(t.durationMs / 1000).toFixed(1)}s）</span>
                  </summary>
                  <pre className="mono" style={{ fontSize: 11, background: 'var(--paper-2)', padding: 8, borderRadius: 4, overflowX: 'auto', maxHeight: 150 }}>{t.outputTail || '(无输出)'}</pre>
                </details>
              ))}
            </>
          )}
          {cs.status === 'tested' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="primary" onClick={() => void accept()} disabled={busy != null}>
                {busy === 'accept' ? <span className="spin" /> : '✓'} 接受修改
              </button>
              <button onClick={() => void rollback()} disabled={busy != null}>
                {busy === 'rollback' ? <span className="spin" /> : '↩'} 全部撤销
              </button>
            </div>
          )}
          {cs.tests.some(t => !t.ok) && cs.status === 'tested' && (
            <p style={{ fontSize: 12, color: 'var(--amber)', marginTop: 6 }}>⚠️ 有检查未通过——可能是项目本来就有的问题，也可能是这次改出来的。可以撤销，也可以接受后再让 AI 修。</p>
          )}
        </>
      )}

      {cs.status === 'accepted' && <p style={{ color: 'var(--pine)', marginTop: 8 }}>✓ 已接受并保存到 Git。{onReset && <button className="ghost" onClick={onReset} style={{ marginLeft: 8 }}>好的</button>}</p>}
      {cs.status === 'rolledback' && <p style={{ color: 'var(--ink-2)', marginTop: 8 }}>↩ 已回滚。{onReset && <button className="ghost" onClick={onReset} style={{ marginLeft: 8 }}>好的</button>}</p>}

      <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 10 }}>本次 AI 花费：${cs.aiCostUsd.toFixed(3)}</p>
    </div>
  );
}
