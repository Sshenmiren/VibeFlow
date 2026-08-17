import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, ReactFlowProvider,
  useNodesState, useEdgesState, useReactFlow, addEdge,
  Handle, Position,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import { api } from '../api.ts';
import { useApp } from '../store.ts';
import { ChangeSetProgress } from './ChangeSetProgress.tsx';

/**
 * 构建蓝图：完全自由的画布。
 * 与 Scratch 式可视化编程不同——每个模块做什么、每条线是什么意思，都由用户自己写。
 * 画好逻辑链条后按「确认」，整张蓝图打包发给 AI 在真实项目里实现。
 */

let idCounter = 0;
const freshId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${idCounter++}`;

// ---------- 模块节点（标题和说明都是可编辑输入框） ----------

function BlockNode({ id, data, selected }: NodeProps) {
  const d = data as { title: string; desc: string };
  const { updateNodeData, deleteElements } = useReactFlow();
  return (
    <div className={`map-node builder-block ${selected ? 'selected' : ''}`} style={{ minWidth: 200, maxWidth: 240 }}>
      <Handle type="target" position={Position.Left} style={{ width: 10, height: 10, background: 'var(--azure)' }} />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          className="nodrag"
          style={{ flex: 1, fontFamily: 'var(--serif)', fontWeight: 600, fontSize: 14, border: 'none', background: 'transparent', padding: '2px 0' }}
          placeholder="模块叫什么…"
          value={d.title}
          onChange={e => updateNodeData(id, { title: e.target.value })}
          aria-label="模块名称"
        />
        <button className="ghost nodrag" style={{ padding: '0 6px', fontSize: 12 }} title="删除模块"
          onClick={() => void deleteElements({ nodes: [{ id }] })}>✕</button>
      </div>
      <textarea
        className="nodrag nowheel"
        rows={3}
        style={{ width: '100%', fontSize: 12, border: '1px dashed var(--line)', background: 'var(--paper-2)', marginTop: 4, resize: 'none' }}
        placeholder="这个模块做什么？用你自己的话写…"
        value={d.desc}
        onChange={e => updateNodeData(id, { desc: e.target.value })}
        aria-label="模块说明"
      />
      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 3 }}>从右侧圆点拖线可连接其他模块 →</div>
      <Handle type="source" position={Position.Right} style={{ width: 10, height: 10, background: 'var(--cinnabar)' }} />
    </div>
  );
}

const builderNodeTypes = { block: BlockNode };

// ---------- 画布 ----------

function BuilderInner() {
  const { meta, changesets, updateChangeSet, showToast } = useApp();
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [dismissedCsId, setDismissedCsId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectId = meta?.id;

  // 载入已保存的蓝图
  useEffect(() => {
    if (!projectId) return;
    setLoaded(false);
    api.blueprint(projectId).then(bp => {
      setNodes(bp.blocks.map(b => ({
        id: b.id, type: 'block', position: { x: b.x, y: b.y }, data: { title: b.title, desc: b.desc },
      })));
      setEdges(bp.connections.map(c => makeEdge(c.id, c.source, c.target, c.label)));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [projectId, setNodes, setEdges]);

  // 任何改动 → 去抖持久化（刷新页面不丢）
  useEffect(() => {
    if (!loaded || !projectId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api.saveBlueprint(projectId, {
        blocks: nodes.map(n => ({
          id: n.id,
          title: (n.data as { title: string }).title,
          desc: (n.data as { desc: string }).desc,
          x: Math.round(n.position.x),
          y: Math.round(n.position.y),
        })),
        connections: edges.map(e => ({
          id: e.id, source: e.source, target: e.target, label: typeof e.label === 'string' ? e.label : '',
        })),
      }).catch(() => { /* 静默 */ });
    }, 800);
  }, [nodes, edges, loaded, projectId]);

  const addBlock = useCallback(() => {
    const base = screenToFlowPosition({ x: 340, y: 200 });
    setNodes(nds => [...nds, {
      id: freshId('blk'), type: 'block',
      // 阶梯网格摆放，避免新模块互相叠住手柄
      position: { x: base.x + (nds.length % 3) * 300, y: base.y + Math.floor(nds.length / 3) * 200 },
      data: { title: '', desc: '' },
    }]);
  }, [screenToFlowPosition, setNodes]);

  // 拖线连接 → 生成待命名的连线并选中它
  const onConnect = useCallback((conn: Connection) => {
    const id = freshId('con');
    setEdges(eds => addEdge(makeEdge(id, conn.source, conn.target, ''), eds));
    setSelectedEdgeId(id);
  }, [setEdges]);

  const selectedEdge = edges.find(e => e.id === selectedEdgeId) ?? null;

  const setEdgeLabel = (id: string, label: string) => {
    setEdges(eds => eds.map(e => (e.id === id ? { ...e, label } : e)));
  };

  const deleteEdge = (id: string) => {
    setEdges(eds => eds.filter(e => e.id !== id));
    setSelectedEdgeId(null);
  };

  // 发给 AI
  const activeCs = changesets.find(c => c.nodeId === 'blueprint' && c.id !== dismissedCsId && !['accepted', 'rolledback'].includes(c.status));
  const send = async () => {
    if (!projectId) return;
    setSending(true);
    try {
      // 先把最新状态存了再发
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await api.saveBlueprint(projectId, {
        blocks: nodes.map(n => ({ id: n.id, title: (n.data as { title: string }).title, desc: (n.data as { desc: string }).desc, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
        connections: edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: typeof e.label === 'string' ? e.label : '' })),
      });
      const cs = await api.sendBlueprint(projectId);
      updateChangeSet(cs);
      setDismissedCsId(null);
      showToast('蓝图已打包成任务，确认计划后点「开始执行」');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally { setSending(false); }
  };

  const unnamed = nodes.filter(n => !(n.data as { title: string }).title.trim()).length;
  const unlabeled = edges.filter(e => !(typeof e.label === 'string' && e.label.trim())).length;

  return (
    <>
    <div className="canvas-area paper-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={builderNodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={(_, e) => setSelectedEdgeId(e.id)}
        onPaneClick={() => setSelectedEdgeId(null)}
        deleteKeyCode={['Delete']}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background color="#b0a17f" gap={28} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* 工具条 */}
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, zIndex: 10 }}>
        <button className="primary" onClick={addBlock}>＋ 新模块</button>
        <button className="primary" style={{ background: 'var(--pine)', borderColor: 'var(--pine)' }}
          onClick={() => void send()} disabled={sending || nodes.length === 0 || !!activeCs}>
          {sending ? <><span className="spin" /> 打包中…</> : '✔ 确认，发给 AI 实现'}
        </button>
      </div>

      {/* 连线编辑器 */}
      {selectedEdge && (
        <div style={{
          position: 'absolute', top: 60, left: 12, zIndex: 10, background: 'var(--card)',
          border: '1.5px solid var(--ink)', borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: 12, width: 320,
        }} className="fade-in">
          <div className="section-label" style={{ marginTop: 0 }}>这条线是什么意思？</div>
          <input
            autoFocus
            style={{ width: '100%' }}
            placeholder="比如：把用户输入传过去 / 点击后触发…"
            value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
            onChange={e => setEdgeLabel(selectedEdge.id, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setSelectedEdgeId(null); }}
            aria-label="连线含义"
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={() => setSelectedEdgeId(null)}>好了</button>
            <button className="ghost" style={{ color: 'var(--danger)' }} onClick={() => deleteEdge(selectedEdge.id)}>删除这条线</button>
          </div>
        </div>
      )}

      {loaded && nodes.length === 0 && (
        <div className="empty-state" style={{ pointerEvents: 'none' }}>
          <div className="big">一张白纸，随便画</div>
          <p>点左上角「＋ 新模块」开始。<br />模块是什么、怎么连、什么意思——全由你说了算。</p>
        </div>
      )}
    </div>

    {/* 右侧状态面板（占 shell 网格右栏，不遮挡画布） */}
    <aside className="detail-panel" aria-label="蓝图状态">
      <div style={{ padding: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>🧩 构建蓝图</h3>
        {!activeCs && (
          <>
            <p style={{ fontSize: 12, color: 'var(--ink-2)' }}>
              这里不是 Scratch——没有预制积木。<strong>每个模块做什么、每条线是什么意思，都由你自己写。</strong>
              画好逻辑链条后点「确认」，AI 会在项目里真实实现它。
            </p>
            <ol style={{ fontSize: 12, color: 'var(--ink-2)', paddingLeft: 18, margin: '6px 0' }}>
              <li>「＋ 新模块」拖到喜欢的位置</li>
              <li>写上模块名字和它该做的事</li>
              <li>从模块右侧圆点拖线连到另一个模块，写上这条线的含义</li>
              <li>点「✔ 确认，发给 AI 实现」</li>
            </ol>
            <div style={{ fontSize: 12 }}>
              <span className="chip">{nodes.length} 个模块</span>
              <span className="chip">{edges.length} 条连线</span>
              {unnamed > 0 && <span className="chip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>{unnamed} 个模块没起名</span>}
              {unlabeled > 0 && <span className="chip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>{unlabeled} 条线没写含义</span>}
            </div>
          </>
        )}
        {activeCs && (
          <>
            <details style={{ fontSize: 12, margin: '6px 0' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--ink-2)' }}>发给 AI 的完整说明</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, background: 'var(--paper-2)', padding: 8, borderRadius: 4 }}>{activeCs.instruction}</pre>
            </details>
            <ChangeSetProgress projectId={projectId!} cs={activeCs} onReset={() => setDismissedCsId(activeCs.id)} />
          </>
        )}
      </div>
    </aside>
    </>
  );
}

function makeEdge(id: string, source: string, target: string, label: string): Edge {
  return {
    id, source, target, label,
    type: 'smoothstep',
    markerEnd: { type: 'arrowclosed' as const, color: '#b73e21' },
    style: { stroke: '#b73e21', strokeWidth: 1.8 },
  };
}

export function BuilderCanvas() {
  return (
    <ReactFlowProvider>
      <BuilderInner />
    </ReactFlowProvider>
  );
}
