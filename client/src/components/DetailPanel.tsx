import { useCallback, useEffect, useRef, useState } from 'react';
import type { BizNode, ChangeSet, ImpactResult, NodeExplanation, SourceRef } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useApp } from '../store.ts';
import { ChangeSetProgress } from './ChangeSetProgress.tsx';

type Tab = 'explain' | 'ask' | 'modify' | 'impact' | 'source' | 'history';

export function DetailPanel() {
  const { meta, views, selectedNodeId, selectNode, devMode, changesets, staleNodeIds } = useApp();
  const [tab, setTab] = useState<Tab>('explain');

  useEffect(() => { setTab(selectedNodeId?.startsWith('file:') ? 'source' : 'explain'); }, [selectedNodeId]);

  if (!meta || !selectedNodeId) return null;

  const isTechNode = selectedNodeId.startsWith('file:');
  let bizNode: BizNode | null = null;
  if (!isTechNode && views) {
    for (const v of views.views) {
      const n = v.nodes.find(x => x.id === selectedNodeId);
      if (n) { bizNode = n; break; }
    }
  }
  if (!isTechNode && !bizNode) return null;

  const title = isTechNode ? selectedNodeId.slice(5).split('/').pop() : bizNode!.title;
  const nodeChangesets = changesets.filter(c => c.nodeId === selectedNodeId);
  const isStale = staleNodeIds.has(selectedNodeId);

  const tabs: { key: Tab; label: string }[] = isTechNode
    ? [{ key: 'source', label: '源码' }, { key: 'ask', label: '提问' }, { key: 'impact', label: '影响范围' }]
    : [
        { key: 'explain', label: '说明' },
        { key: 'ask', label: '提问' },
        { key: 'modify', label: '修改' },
        { key: 'impact', label: '影响范围' },
        { key: 'source', label: '源码' },
        { key: 'history', label: `历史${nodeChangesets.length ? ` ${nodeChangesets.length}` : ''}` },
      ];

  return (
    <aside className="detail-panel fade-in" aria-label="节点详情">
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>
            {bizNode?.icon && <span aria-hidden style={{ marginRight: 6 }}>{bizNode.icon}</span>}
            {title}
          </h2>
          <button className="ghost" onClick={() => selectNode(null)} aria-label="关闭详情" title="关闭 (Esc)">✕</button>
        </div>
        {bizNode && <p style={{ margin: '4px 0 0', color: 'var(--ink-2)', fontSize: 13 }}>{bizNode.summary}</p>}
        {isStale && (
          <div style={{ background: 'var(--amber-soft)', border: '1px solid var(--amber)', borderRadius: 6, padding: '6px 10px', fontSize: 12, marginTop: 8 }}>
            ⚠️ 相关代码已发生变化，当前说明可能已过时——点击「说明」标签会自动重新生成。
          </div>
        )}
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 12, borderBottom: '1px solid var(--line)', paddingBottom: 8 }} aria-label="详情标签">
          {tabs.map(t => (
            <button key={t.key} className={tab === t.key ? '' : 'ghost'} style={{ fontSize: 12, padding: '3px 10px' }}
              onClick={() => setTab(t.key)} aria-pressed={tab === t.key}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div style={{ padding: '12px 16px 20px', flex: 1 }}>
        {tab === 'explain' && bizNode && <ExplainTab projectId={meta.id} node={bizNode} />}
        {tab === 'ask' && <AskTab projectId={meta.id} nodeId={selectedNodeId} />}
        {tab === 'modify' && bizNode && <ModifyTab projectId={meta.id} node={bizNode} />}
        {tab === 'impact' && <ImpactTab projectId={meta.id} nodeId={selectedNodeId} />}
        {tab === 'source' && <SourceTab projectId={meta.id} refs={isTechNode ? [{ file: selectedNodeId.slice(5) }] : bizNode!.sourceRefs} devMode={devMode} />}
        {tab === 'history' && <HistoryTab changesets={nodeChangesets} />}
      </div>
    </aside>
  );
}

// ---------- 说明 ----------

function ExplainTab({ projectId, node }: { projectId: string; node: BizNode }) {
  const [explanation, setExplanation] = useState<NodeExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshSettings } = useApp();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.explanation(projectId, node.id)
      .then(e => { setExplanation(e); void refreshSettings(); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, node.id, refreshSettings]);

  useEffect(() => { setExplanation(null); load(); }, [load]);

  if (loading) return <p><span className="spin" /> AI 正在分析代码并生成说明…（首次约 30-60 秒，之后有缓存）</p>;
  if (error) return <p style={{ color: 'var(--danger)' }}>解释生成失败：{error} <button onClick={load}>重试</button></p>;
  if (!explanation) return null;

  const rows: [string, string][] = [
    ['它是干什么的', explanation.what],
    ['你什么时候会遇到它', explanation.when],
    ['它接收什么', explanation.inputs],
    ['它产生什么结果', explanation.outputs],
    ['出错时你会看到', explanation.onError],
    ['它依赖谁', explanation.dependsOn],
    ['改它会影响哪里', explanation.impact],
  ];
  return (
    <div className="fade-in">
      {rows.map(([label, text]) => (
        <div key={label}>
          <div className="section-label">{label}</div>
          <p style={{ margin: 0, fontSize: 13 }}>{text}</p>
        </div>
      ))}
      <div className="section-label">它的工作步骤（伪代码）</div>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
        {explanation.pseudocode.map((line, i) => <li key={i}>{line.replace(/^第?\d+步[：: ]?\s*/, '')}</li>)}
      </ol>
      <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 12 }}>
        生成于 {new Date(explanation.generatedAt).toLocaleString('zh-CN')} · 基于真实源码
      </p>
    </div>
  );
}

// ---------- 提问 ----------

function AskTab({ projectId, nodeId }: { projectId: string; nodeId: string }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const { showToast, refreshSettings } = useApp();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages([]); }, [nodeId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const { answer } = await api.ask(projectId, nodeId, q);
      setMessages(m => [...m, { role: 'ai', text: answer }]);
      void refreshSettings();
    } catch (err) {
      showToast((err as Error).message, 'error');
      setMessages(m => m.slice(0, -1));
      setInput(q);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ flex: 1, minHeight: 120 }}>
        {messages.length === 0 && (
          <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>
            只回答与该节点相关的问题，例如：<br />「这里如果出错会怎样？」「这个功能的数据存在哪？」
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            background: m.role === 'user' ? 'var(--paper-2)' : 'var(--pine-soft)',
            borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: 13,
          }}>
            <strong style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.role === 'user' ? '你' : 'AI'}</strong>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
          </div>
        ))}
        {busy && <p><span className="spin" /> 思考中…</p>}
        <div ref={endRef} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={{ flex: 1 }} value={input} placeholder="输入关于该节点的问题…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void send(); }}
          aria-label="提问输入框" />
        <button className="primary" onClick={() => void send()} disabled={busy || !input.trim()}>发送</button>
      </div>
    </div>
  );
}

// ---------- 修改 ----------

function ModifyTab({ projectId, node }: { projectId: string; node: BizNode }) {
  const { changesets, updateChangeSet, showToast } = useApp();
  const [instruction, setInstruction] = useState('');
  const [dismissedCsId, setDismissedCsId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeCs = changesets.find(c =>
    c.nodeId === node.id && c.id !== dismissedCsId && !['accepted', 'rolledback'].includes(c.status));

  const createPlan = async () => {
    const text = instruction.trim();
    if (!text) return;
    setBusy(true);
    try {
      const cs = await api.createModify(projectId, node.id, text);
      updateChangeSet(cs);
      setDismissedCsId(null);
      setInstruction('');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally { setBusy(false); }
  };

  if (!activeCs) {
    return (
      <div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>用平常说话的方式描述你想要的改变，AI 会定位代码、给出计划和改动，测试通过后你再决定要不要。</p>
        <textarea rows={4} style={{ width: '100%' }} value={instruction}
          placeholder={`例如：把「${node.title}」改成…`}
          onChange={e => setInstruction(e.target.value)}
          aria-label="修改要求" />
        <button className="primary" style={{ marginTop: 8 }} onClick={() => void createPlan()}
          disabled={!instruction.trim() || busy}>
          {busy ? <><span className="spin" /> 制定计划…</> : '生成修改计划'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="section-label">修改要求</div>
      <p style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-wrap' }}>{activeCs.instruction}</p>
      <ChangeSetProgress projectId={projectId} cs={activeCs} onReset={() => setDismissedCsId(activeCs.id)} />
    </div>
  );
}

// ---------- 影响范围 ----------

function ImpactTab({ projectId, nodeId }: { projectId: string; nodeId: string }) {
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { selectNode } = useApp();

  useEffect(() => {
    setImpact(null);
    api.impact(projectId, nodeId).then(setImpact).catch((e: Error) => setError(e.message));
  }, [projectId, nodeId]);

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!impact) return <p><span className="spin" /> 计算影响范围…</p>;

  return (
    <div className="fade-in" style={{ fontSize: 13 }}>
      <div className="section-label">该节点直接使用的文件</div>
      {impact.files.map(f => <span key={f} className="chip mono">{f}</span>)}
      <div className="section-label">改了它可能波及的文件（{impact.dependents.length}）</div>
      {impact.dependents.length === 0 ? <p style={{ color: 'var(--ink-3)', margin: 0 }}>没有其他文件依赖它，影响范围很小。</p>
        : impact.dependents.map(f => <span key={f} className="chip mono">{f}</span>)}
      <div className="section-label">同时受影响的节点（{impact.relatedBizNodes.length}）</div>
      {impact.relatedBizNodes.map(n => (
        <button key={n.id} className="ghost" style={{ display: 'block', padding: '3px 8px', fontSize: 12 }}
          onClick={() => selectNode(n.id)}>
          → {n.title}
        </button>
      ))}
    </div>
  );
}

// ---------- 源码 ----------

function SourceTab({ projectId, refs, devMode }: { projectId: string; refs: SourceRef[]; devMode: boolean }) {
  const [activeRef, setActiveRef] = useState<SourceRef | null>(refs[0] ?? null);
  const [content, setContent] = useState<string | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActiveRef(refs[0] ?? null); }, [refs]);
  useEffect(() => {
    if (!activeRef) return;
    setContent(null);
    api.file(projectId, activeRef.file).then(r => setContent(r.content)).catch((e: Error) => setContent(`读取失败：${e.message}`));
  }, [projectId, activeRef]);

  useEffect(() => {
    if (content && activeRef?.startLine) {
      setTimeout(() => lineRef.current?.scrollIntoView({ block: 'center' }), 50);
    }
  }, [content, activeRef]);

  if (!activeRef) return <p>没有关联源码。</p>;
  const lines = content?.split('\n') ?? [];

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        {refs.map(r => (
          <button key={`${r.file}${r.symbol ?? ''}`} className={r === activeRef ? '' : 'ghost'}
            style={{ fontSize: 11, padding: '2px 8px', marginRight: 4, marginBottom: 4 }}
            onClick={() => setActiveRef(r)}>
            <span className="mono">{r.file.split('/').pop()}{r.symbol ? ` · ${r.symbol}` : ''}</span>
          </button>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6 }}>
        {activeRef.file}{activeRef.startLine ? `  第 ${activeRef.startLine}-${activeRef.endLine} 行` : ''}
      </div>
      {content === null ? <p><span className="spin" /> 读取中…</p> : (
        <div className="mono" style={{ fontSize: 11.5, background: 'var(--paper-2)', borderRadius: 6, maxHeight: 420, overflow: 'auto', border: '1px solid var(--line)' }}>
          {lines.map((line, i) => {
            const num = i + 1;
            const inRange = activeRef.startLine != null && activeRef.endLine != null && num >= activeRef.startLine && num <= activeRef.endLine;
            return (
              <div key={i} ref={activeRef.startLine === num ? lineRef : undefined}
                style={{ display: 'flex', background: inRange ? 'var(--cinnabar-soft)' : undefined }}>
                <span style={{ width: 42, textAlign: 'right', paddingRight: 8, color: 'var(--ink-3)', userSelect: 'none', flexShrink: 0 }}>{num}</span>
                <span style={{ whiteSpace: 'pre', paddingRight: 12 }}>{line || ' '}</span>
              </div>
            );
          })}
        </div>
      )}
      {devMode && <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>开发者提示：完整文件在 {activeRef.file}</p>}
    </div>
  );
}

// ---------- 历史 ----------

function HistoryTab({ changesets }: { changesets: ChangeSet[] }) {
  if (changesets.length === 0) return <p style={{ color: 'var(--ink-3)' }}>该节点还没有被 AI 修改过。</p>;
  const statusLabel: Record<string, string> = {
    planned: '待执行', executing: '修改中', diffed: '待验收', testing: '测试中',
    tested: '待验收', accepted: '✓ 已接受', rolledback: '↩ 已回滚', failed: '✗ 失败', planning: '计划中',
  };
  return (
    <div style={{ fontSize: 13 }}>
      {changesets.map(cs => (
        <div key={cs.id} style={{ borderLeft: '3px solid var(--line-strong)', paddingLeft: 10, marginBottom: 12 }}>
          <div style={{ fontWeight: 500 }}>{cs.instruction}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {statusLabel[cs.status] ?? cs.status} · {new Date(cs.createdAt).toLocaleString('zh-CN')} · {cs.changedFiles.length} 个文件 · ${cs.aiCostUsd.toFixed(3)}
          </div>
        </div>
      ))}
    </div>
  );
}
