import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider,
  applyNodeChanges, useReactFlow,
  type Edge, type Node, type NodeChange,
} from '@xyflow/react';
import type { ViewLayouts } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useApp } from '../store.ts';
import { layoutBizView, layoutTechGraph } from '../layout.ts';
import { nodeTypes } from './MapNodes.tsx';

function CanvasInner() {
  const { views, graph, activeView, staleNodeIds, selectedNodeId, selectNode, meta, generatingViews, generateViews, analysisProgress } = useApp();
  const { fitView } = useReactFlow();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const layoutsRef = useRef<ViewLayouts>({});
  const [layoutsLoaded, setLayoutsLoaded] = useState(0);
  const lastViewRef = useRef<string>('');
  const projectId = meta?.id;

  // 载入用户手动摆放的位置
  useEffect(() => {
    if (!projectId) return;
    layoutsRef.current = {};
    api.layout(projectId)
      .then(l => { layoutsRef.current = l; setLayoutsLoaded(v => v + 1); })
      .catch(() => setLayoutsLoaded(v => v + 1));
  }, [projectId]);

  // 数据/视图变化时重算自动布局，但用户摆过的位置优先
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
    setNodes(computed.nodes);
    setEdges(computed.edges);
    // 只在切换视图时自动取景，不打断用户的手动摆放
    if (lastViewRef.current !== activeView) {
      lastViewRef.current = activeView;
      setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 60);
    }
  }, [views, graph, activeView, layoutsLoaded, fitView]);

  // 选中/变化标记：只改 data，不重排位置
  useEffect(() => {
    setNodes(nds => nds.map(n => n.type === 'folder' ? n : ({
      ...n,
      data: { ...n.data, selected: n.id === selectedNodeId, stale: staleNodeIds.has(n.id) },
    })));
  }, [selectedNodeId, staleNodeIds]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  // 拖动结束 → 持久化位置（箭头由 React Flow 自动跟随）
  const onNodeDragStop = useCallback((_e: unknown, _node: Node, dragged: Node[]) => {
    if (!projectId) return;
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of dragged) positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    layoutsRef.current[activeView] = { ...layoutsRef.current[activeView], ...positions };
    void api.saveLayout(projectId, activeView, positions).catch(() => { /* 保存失败不打断操作 */ });
  }, [projectId, activeView]);

  const isAnalyzing = meta?.status === 'analyzing' || analysisProgress != null;
  const noViews = !views && activeView !== 'tech';
  const emptyProject = meta?.status === 'empty';

  return (
    <div className="canvas-area paper-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, node) => { if (node.type !== 'folder') selectNode(node.id); }}
        onPaneClick={() => selectNode(null)}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        nodesDraggable
        fitView
      >
        <Background color="#b0a17f" gap={28} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#d8cdb2" maskColor="rgba(244, 238, 221, 0.7)" />
      </ReactFlow>

      {isAnalyzing && (
        <div className="empty-state" style={{ background: 'rgba(244,238,221,0.88)' }}>
          <div className="big">正在阅读你的项目…</div>
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

      {!isAnalyzing && emptyProject && (
        <div className="empty-state">
          <div className="big">这还是一片空白的地图</div>
          <p>开始写代码（或者让 Claude Code 开始干活），<br />文件一出现，地图就会自己长出来。<br />也可以去「构建蓝图」先画出你想要的东西。</p>
        </div>
      )}

      {!isAnalyzing && !emptyProject && noViews && (
        <div className="empty-state" style={{ background: 'rgba(244,238,221,0.82)' }}>
          <div className="big">项目已读完，等你一声令下</div>
          <p>让 AI 把 {meta?.fileCount ?? 0} 个文件翻译成普通人能看懂的地图。</p>
          <button className="primary" onClick={() => void generateViews()} disabled={generatingViews}>
            {generatingViews ? <><span className="spin" /> 正在绘制地图（约 1-2 分钟）…</> : '🗺️ 生成项目地图'}
          </button>
        </div>
      )}

      {!isAnalyzing && !noViews && activeView !== 'tech' && views && !views.views.find(v => v.kind === activeView)?.nodes.length && (
        <div className="empty-state">
          <div className="big">这个视图暂时没有内容</div>
        </div>
      )}
    </div>
  );
}

export function MapCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
