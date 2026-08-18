import { useEffect, useRef, useState } from 'react';
import type { ChangeSet } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useApp } from '../store.ts';
import { DiffView } from './DiffView.tsx';

/** 修改单全生命周期展示：计划 → 执行(直播) → diff → 测试 → 继续调整 / 接受 / 回滚。节点修改和新构想共用。 */
export function ChangeSetProgress({ projectId, cs, onReset }: { projectId: string; cs: ChangeSet; onReset?: () => void }) {
  const { updateChangeSet, showToast, refreshSettings, refreshAll, modifyLogs } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [refineText, setRefineText] = useState('');
  const logs = modifyLogs[cs.id] ?? [];
  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logEndRef.current?.scrollIntoView({ block: 'nearest' }); }, [logs.length]);

  const refine = async () => {
    const text = refineText.trim();
    if (!text) return;
    setBusy('refine');
    try {
      await api.refineChangeSet(projectId, cs.id, text);
      setRefineText('');
    } catch (err) { showToast((err as Error).message, 'error'); }
    finally { setBusy(null); }
  };

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

      {cs.status === 'executing' && (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 6px' }}><span className="spin" /> AI 正在干活（实时直播）：</p>
          <div className="mono" style={{
            fontSize: 11, background: 'var(--paper-2)', border: '1px solid var(--line)',
            borderRadius: 6, padding: '6px 10px', maxHeight: 150, overflowY: 'auto',
          }}>
            {logs.length === 0 && <div style={{ color: 'var(--ink-3)' }}>启动中…</div>}
            {logs.map((l, i) => <div key={i}>{l}</div>)}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
      {cs.status === 'testing' && <p style={{ marginTop: 10 }}><span className="spin" /> 正在运行测试和检查…（首次会先记录一次基线）</p>}

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
                    {t.ok ? '✅' : t.newFailure === false ? '⚠️' : '❌'} <span className="mono">{t.command}</span>
                    {!t.ok && t.newFailure === false && <span style={{ color: 'var(--amber)' }}>（修改前就是挂的，不怪这次）</span>}
                    {!t.ok && t.newFailure === true && <span style={{ color: 'var(--danger)', fontWeight: 700 }}>（这次修改弄挂的！）</span>}
                    <span style={{ color: 'var(--ink-3)' }}>（{(t.durationMs / 1000).toFixed(1)}s）</span>
                  </summary>
                  <pre className="mono" style={{ fontSize: 11, background: 'var(--paper-2)', padding: 8, borderRadius: 4, overflowX: 'auto', maxHeight: 150 }}>{t.outputTail || '(无输出)'}</pre>
                </details>
              ))}
            </>
          )}
          {cs.status === 'tested' && (
            <>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="primary" onClick={() => void accept()} disabled={busy != null}>
                  {busy === 'accept' ? <span className="spin" /> : '✓'} 接受修改
                </button>
                <button onClick={() => void rollback()} disabled={busy != null}>
                  {busy === 'rollback' ? <span className="spin" /> : '↩'} 全部撤销
                </button>
              </div>
              {cs.sessionId && (
                <div style={{ marginTop: 10 }}>
                  <div className="section-label">不太满意？直接说怎么调（在原改动上继续，不推翻）</div>
                  {(cs.refinements ?? []).map((r, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--ink-3)' }}>↻ 已调整过：{r}</div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <input style={{ flex: 1 }} value={refineText}
                      placeholder="比如：按钮改放到左边 / 弹窗字再大一点…"
                      onChange={e => setRefineText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void refine(); }}
                      aria-label="继续调整" />
                    <button onClick={() => void refine()} disabled={busy != null || !refineText.trim()}>
                      {busy === 'refine' ? <span className="spin" /> : '↻'} 继续调整
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {cs.tests.some(t => t.newFailure) && cs.status === 'tested' && (
            <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>❌ 这次修改弄挂了一些检查——建议「全部撤销」，或用下面的继续调整让 AI 修好它。</p>
          )}
          {cs.tests.some(t => !t.ok && t.newFailure === false) && !cs.tests.some(t => t.newFailure) && cs.status === 'tested' && (
            <p style={{ fontSize: 12, color: 'var(--amber)', marginTop: 6 }}>⚠️ 有检查没过，但都是修改前就存在的问题，与这次改动无关。</p>
          )}
        </>
      )}

      {cs.status === 'accepted' && <p style={{ color: 'var(--pine)', marginTop: 8 }}>✓ 已接受并保存到 Git。{onReset && <button className="ghost" onClick={onReset} style={{ marginLeft: 8 }}>好的</button>}</p>}
      {cs.status === 'rolledback' && <p style={{ color: 'var(--ink-2)', marginTop: 8 }}>↩ 已回滚。{onReset && <button className="ghost" onClick={onReset} style={{ marginLeft: 8 }}>好的</button>}</p>}

      <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 10 }}>本次 AI 花费：${cs.aiCostUsd.toFixed(3)}</p>
    </div>
  );
}
