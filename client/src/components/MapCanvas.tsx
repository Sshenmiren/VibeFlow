import { useEffect, useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useApp } from '../store.ts';
import { layoutBizView, layoutTechGraph } from '../layout.ts';
import { nodeTypes } from './MapNodes.tsx';

function CanvasInner() {
  const { views, graph, activeView, staleNodeIds, selectedNodeId, selectNode, meta, generatingViews, generateViews, analysisProgress } = useApp();
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    if (activeView === 'tech') {
      if (!graph) return { nodes: [], edges: [] };
      // 技术图 stale 用文件路径
      const staleFiles = new Set([...staleNodeIds].filter(s => !s.includes(':')).map(s => s));
      return layoutTechGraph(graph, staleFiles, selectedNodeId);
    }
    const view = views?.views.find(v => v.kind === activeView);
    if (!view) return { nodes: [], edges: [] };
    return layoutBizView(view, staleNodeIds, selectedNodeId);
  }, [views, graph, activeView, staleNodeIds, selectedNodeId]);

  useEffect(() => {
    // 切视图后自动取景
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [activeView, views, fitView]);

  const isAnalyzing = meta?.status === 'analyzing' || analysisProgress != null;
  const noViews = !views && activeView !== 'tech';
  const emptyProject = meta?.status === 'empty';

  return (
    <div className="canvas-area paper-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
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
          <p>开始写代码（或者让 Claude Code 开始干活），<br />文件一出现，地图就会自己长出来。</p>
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
