import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider,
  applyNodeChanges, useReactFlow,
  type Connection, type Edge, type Node, type NodeChange,
} from '@xyflow/react';
import type { Blueprint, ViewLayouts } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { selectActiveDraftCs, useApp } from '../store.ts';
import { layoutBizView, layoutTechGraph } from '../layout.ts';
import { nodeTypes } from './MapNodes.tsx';
import { edgeTypes } from './MapEdges.tsx';
import { ChangeSetProgress } from './ChangeSetProgress.tsx';

let draftCounter = 0;
const freshDraftId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${draftCounter++}`;

const DRAFT_EDGE_STYLE = { stroke: '#b73e21', strokeWidth: 1.8, strokeDasharray: '6 4' };

function CanvasInner() {
  const {
    views, graph, activeView, staleNodeIds, selectedNodeId, selectNode, meta,
    generatingViews, generateViews, analysisProgress, changesets, updateChangeSet, showToast,
  } = useApp();
  const { fitView, screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const layoutsRef = useRef<ViewLayouts>({});
  const blueprintRef = useRef<Blueprint>({ blocks: [], connections: [], updatedAt: '' });
  const [storesLoaded, setStoresLoaded] = useState(0);
  const [selectedDraftEdgeId, setSelectedDraftEdgeId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { dismissedDraftCsId, dismissDraftCs } = useApp();
  const sentViewRef = useRef<Record<string, string>>({}); // csId -> viewKind
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastViewRef = useRef<string>('');
  const projectId = meta?.id;
  const isBizView = activeView !== 'tech';

  // ---------- 载入持久化状态（手动布局 + 草稿蓝图） ----------
  useEffect(() => {
    if (!projectId) return;
    layoutsRef.current = {};
    blueprintRef.current = { blocks: [], connections: [], updatedAt: '' };
    Promise.allSettled([api.layout(projectId), api.blueprint(projectId)]).then(([l, b]) => {
      if (l.status === 'fulfilled') layoutsRef.current = l.value;
      if (b.status === 'fulfilled') blueprintRef.current = b.value;
      setStoresLoaded(v => v + 1);
    });
  }, [projectId]);

  const scheduleSaveBlueprint = useCallback(() => {
    if (!projectId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api.saveBlueprint(projectId, {
        blocks: blueprintRef.current.blocks,
        connections: blueprintRef.current.connections,
      }).catch(() => { /* 静默 */ });
    }, 700);
  }, [projectId]);

  // ---------- 草稿操作 ----------
  const updateDraft = useCallback((id: string, patch: { title?: string; desc?: string }) => {
    const b = blueprintRef.current.blocks.find(x => x.id === id);
    if (b) Object.assign(b, patch);
    setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    scheduleSaveBlueprint();
  }, [scheduleSaveBlueprint]);

  const deleteDraft = useCallback((id: string) => {
    blueprintRef.current.blocks = blueprintRef.current.blocks.filter(b => b.id !== id);
    blueprintRef.current.connections = blueprintRef.current.connections.filter(c => c.source !== id && c.target !== id);
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    setSelectedDraftEdgeId(null);
    scheduleSaveBlueprint();
  }, [scheduleSaveBlueprint]);

  const draftToNode = useCallback((b: Blueprint['blocks'][number]): Node => ({
    id: b.id,
    type: 'draft',
    position: { x: b.x, y: b.y },
    data: { title: b.title, desc: b.desc, onChange: updateDraft, onDelete: deleteDraft },
  }), [updateDraft, deleteDraft]);

  // 草稿连线：朱砂粗虚线 + 同色标签，与分析出的彩色实线区分开（"还不存在的东西"）
  const draftToEdge = (c: Blueprint['connections'][number]): Edge => ({
    id: c.id, source: c.source, target: c.target, label: c.label,
    type: 'biz',
    data: { labelShift: 0, borderRadius: 14, offset: 20 },
    markerEnd: { type: 'arrowclosed' as const, color: '#b73e21', width: 16, height: 16 },
    style: DRAFT_EDGE_STYLE,
    className: 'draft-edge',
    labelStyle: { color: '#b73e21', borderColor: '#b73e21' },
  });

  const addDraft = useCallback(() => {
    const base = screenToFlowPosition({ x: 380, y: 220 });
    const count = blueprintRef.current.blocks.filter(b => b.view === activeView).length;
    const block = {
      id: freshDraftId('draft'),
      title: '', desc: '',
      x: base.x + (count % 3) * 290, y: base.y + Math.floor(count / 3) * 190,
      view: activeView,
    };
    blueprintRef.current.blocks.push(block);
    setNodes(nds => [...nds, draftToNode(block)]);
    scheduleSaveBlueprint();
  }, [activeView, screenToFlowPosition, draftToNode, scheduleSaveBlueprint]);

  // 连线：至少一端是草稿模块（现有环节之间的关系由分析器负责，不许手画）
  const onConnect = useCallback((conn: Connection) => {
    const isDraft = (id: string | null) => !!id && id.startsWith('draft_');
    if (!conn.source || !conn.target) return;
    if (!isDraft(conn.source) && !isDraft(conn.target)) {
      showToast('现有节点之间的关系来自代码分析——连线时至少有一端必须是新建模块');
      return;
    }
    const c = { id: freshDraftId('dcon'), source: conn.source, target: conn.target, label: '', view: activeView };
    blueprintRef.current.connections.push(c);
    setEdges(eds => [...eds, draftToEdge(c)]);
    setSelectedDraftEdgeId(c.id);
    scheduleSaveBlueprint();
  }, [activeView, showToast, scheduleSaveBlueprint]);

  const setDraftEdgeLabel = (id: string, label: string) => {
    const c = blueprintRef.current.connections.find(x => x.id === id);
    if (c) c.label = label;
    setEdges(eds => eds.map(e => (e.id === id ? { ...e, label } : e)));
    scheduleSaveBlueprint();
  };

  const deleteDraftEdge = (id: string) => {
    blueprintRef.current.connections = blueprintRef.current.connections.filter(c => c.id !== id);
    setEdges(eds => eds.filter(e => e.id !== id));
    setSelectedDraftEdgeId(null);
    scheduleSaveBlueprint();
  };

  // ---------- 布局合成：分析出的地图 + 当前视图的草稿层 ----------
  useEffect(() => {
    let computed: { nodes: Node[]; edges: Edge[] };
    if (activeView === 'tech') {
      computed = graph ? layoutTechGraph(graph, new Set(), selectedNodeId) : { nodes: [], edges: [] };
    } else {
      const view = views?.views.find(v => v.kind === activeView);
      computed = view ? layoutBizView(view, staleNodeIds, selectedNodeId) : { nodes: [], edges: [] };
    }
    const saved = layoutsRef.current[activeView] ?? {};
    computed.nodes = computed.nodes.map(n => (saved[n.id] ? { ...n, position: saved[n.id] } : n));
    if (isBizView) {
      const drafts = blueprintRef.current.blocks.filter(b => b.view === activeView);
      const draftEdges = blueprintRef.current.connections.filter(c => c.view === activeView);
      computed.nodes.push(...drafts.map(draftToNode));
      computed.edges.push(...draftEdges.map(draftToEdge));
    }
    setNodes(computed.nodes);
    setEdges(computed.edges);
    if (lastViewRef.current !== activeView) {
      lastViewRef.current = activeView;
      setSelectedDraftEdgeId(null);
      setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 60);
    }
  }, [views, graph, activeView, storesLoaded, isBizView, draftToNode, fitView]);
  // 注：selectedNodeId/staleNodeIds 的高亮由下面的效果单独处理，不重排布局

  useEffect(() => {
    setNodes(nds => nds.map(n => (n.type !== 'biz' && n.type !== 'techFile') ? n : ({
      ...n,
      data: { ...n.data, selected: n.id === selectedNodeId, stale: staleNodeIds.has(n.id) },
    })));
  }, [selectedNodeId, staleNodeIds]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  // 拖动结束：草稿存进蓝图，地图节点存进布局
  const onNodeDragStop = useCallback((_e: unknown, _node: Node, dragged: Node[]) => {
    if (!projectId) return;
    const layoutPositions: Record<string, { x: number; y: number }> = {};
    for (const n of dragged) {
      if (n.type === 'draft') {
        const b = blueprintRef.current.blocks.find(x => x.id === n.id);
        if (b) { b.x = Math.round(n.position.x); b.y = Math.round(n.position.y); }
      } else {
        layoutPositions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      }
    }
    if (Object.keys(layoutPositions).length > 0) {
      layoutsRef.current[activeView] = { ...layoutsRef.current[activeView], ...layoutPositions };
      void api.saveLayout(projectId, activeView, layoutPositions).catch(() => { /* 静默 */ });
    }
    if (dragged.some(n => n.type === 'draft')) scheduleSaveBlueprint();
  }, [projectId, activeView, scheduleSaveBlueprint]);

  // ---------- 发给 AI ----------
  const draftCount = isBizView ? nodes.filter(n => n.type === 'draft').length : 0;
  const activeDraftCs = selectActiveDraftCs({ changesets, dismissedDraftCsId });

  const sendDrafts = async () => {
    if (!projectId) return;
    setSending(true);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await api.saveBlueprint(projectId, { blocks: blueprintRef.current.blocks, connections: blueprintRef.current.connections });
      const cs = await api.sendBlueprint(projectId, activeView);
      updateChangeSet(cs);
      sentViewRef.current[cs.id] = activeView;
      dismissDraftCs(null);
      selectNode(null); // 让出右栏给新模块进度面板
      showToast('新模块已提交，确认计划后点「开始执行」');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally { setSending(false); }
  };

  // 构想被接受 → 清掉那个视图的草稿（它已经变成真代码了）
  useEffect(() => {
    for (const cs of changesets) {
      const view = sentViewRef.current[cs.id];
      if (view && cs.status === 'accepted') {
        delete sentViewRef.current[cs.id];
        blueprintRef.current.blocks = blueprintRef.current.blocks.filter(b => b.view !== view);
        blueprintRef.current.connections = blueprintRef.current.connections.filter(c => c.view !== view);
        setNodes(nds => nds.filter(n => n.type !== 'draft'));
        setEdges(eds => eds.filter(e => !e.id.startsWith('dcon_')));
        scheduleSaveBlueprint();
        showToast('新模块已实现！代码已变更，点击「重新生成所有视图」更新项目视图');
      }
    }
  }, [changesets, scheduleSaveBlueprint, showToast]);

  const selectedDraftEdge = edges.find(e => e.id === selectedDraftEdgeId) ?? null;
  const isAnalyzing = meta?.status === 'analyzing' || analysisProgress != null;
  const noViews = !views && activeView !== 'tech';
  const emptyProject = meta?.status === 'empty';
  // 构想进度占右栏（节点详情优先）；不悬浮盖图
  const showDraftPanel = activeDraftCs != null && selectedNodeId == null;

  return (
    <>
    <div className="canvas-area paper-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          if (node.type === 'biz' || node.type === 'techFile') selectNode(node.id);
        }}
        onEdgeClick={(_, e) => { if (e.id.startsWith('dcon_')) setSelectedDraftEdgeId(e.id); }}
        onPaneClick={() => { selectNode(null); setSelectedDraftEdgeId(null); }}
        deleteKeyCode={null}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={isBizView}
        nodesDraggable
        fitView
      >
        <Background color="#b0a17f" gap={28} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#d8cdb2" maskColor="rgba(244, 238, 221, 0.7)" />
      </ReactFlow>

      {/* 新建模块工具条（业务视图专属） */}
      {isBizView && !isAnalyzing && (
        <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8, zIndex: 10, alignItems: 'center' }}>
          <button className="primary" onClick={addDraft} title="在当前视图上添加一个新模块">＋ 新建模块</button>
          {draftCount > 0 && !activeDraftCs && (
            <button className="primary" style={{ background: 'var(--pine)', borderColor: 'var(--pine)' }}
              onClick={() => void sendDrafts()} disabled={sending}>
              {sending ? <><span className="spin" /> 提交中…</> : `✔ 让 AI 实现这 ${draftCount} 个模块`}
            </button>
          )}
        </div>
      )}

      {/* 草稿连线编辑器 */}
      {selectedDraftEdge && (
        <div style={{
          position: 'absolute', top: 58, left: 12, zIndex: 11, background: 'var(--card)',
          border: '1.5px solid var(--ink)', borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: 12, width: 320,
        }} className="fade-in">
          <div className="section-label" style={{ marginTop: 0 }}>这条连线表示什么？</div>
          <input
            autoFocus
            style={{ width: '100%' }}
            placeholder="例如：点击后触发 / 把结果传给对方…"
            value={typeof selectedDraftEdge.label === 'string' ? selectedDraftEdge.label : ''}
            onChange={e => setDraftEdgeLabel(selectedDraftEdge.id, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setSelectedDraftEdgeId(null); }}
            aria-label="连线含义"
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={() => setSelectedDraftEdgeId(null)}>确认</button>
            <button className="ghost" style={{ color: 'var(--danger)' }} onClick={() => deleteDraftEdge(selectedDraftEdge.id)}>删除连线</button>
          </div>
        </div>
      )}

      {isAnalyzing && (
        <div className="empty-state" style={{ background: 'rgba(244,238,221,0.88)' }}>
          <div className="big">正在分析项目…</div>
          {analysisProgress && analysisProgress.total > 0 && (
            <>
              <div style={{ width: 260 }} className="progress-bar">
                <div style={{ width: `${(analysisProgress.done / analysisProgress.total) * 100}%` }} />
              </div>
              <div className="mono" style={{ fontSize: 11 }}>
                {analysisProgress.done}/{analysisProgress.total} {analysisProgress.currentFile ?? ''}
              </div>
            </>
          )}
        </div>
      )}

      {!isAnalyzing && emptyProject && draftCount === 0 && (
        <div className="empty-state" style={{ pointerEvents: 'none' }}>
          <div className="big">暂无文件</div>
          <p>开始写代码（或让 Claude Code 开始生成代码），文件出现后视图将自动更新。<br />
            也可以点左上角「＋ 新建模块」，添加模块描述后让 AI 实现。</p>
        </div>
      )}

      {!isAnalyzing && !emptyProject && noViews && draftCount === 0 && (
        <div className="empty-state" style={{ background: 'rgba(244,238,221,0.82)' }}>
          <div className="big">分析完成，点击生成项目视图</div>
          <p>让 AI 将 {meta?.fileCount ?? 0} 个文件转换为可视化的项目视图。</p>
          <button className="primary" onClick={() => void generateViews()} disabled={generatingViews}>
            {generatingViews ? <><span className="spin" /> 正在生成视图（约 1-2 分钟）…</> : '🗺️ 生成项目视图'}
          </button>
        </div>
      )}
    </div>

    {showDraftPanel && activeDraftCs && (
      <aside className="detail-panel fade-in" aria-label="新模块执行进度">
        <div style={{ padding: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>＋ {activeDraftCs.nodeTitle}</h3>
          <details style={{ fontSize: 12, margin: '6px 0' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--ink-2)' }}>发给 AI 的完整说明</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, background: 'var(--paper-2)', padding: 8, borderRadius: 4, maxHeight: 160, overflowY: 'auto' }}>{activeDraftCs.instruction}</pre>
          </details>
          <ChangeSetProgress projectId={projectId!} cs={activeDraftCs} onReset={() => dismissDraftCs(activeDraftCs.id)} />
        </div>
      </aside>
    )}
    </>
  );
}

export function MapCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
