import { useApp, type ActiveView } from '../store.ts';

const VIEW_META: { key: ActiveView; icon: string; label: string; desc: string; dev?: boolean }[] = [
  { key: 'journey', icon: '🧭', label: '用户流程', desc: '用户使用产品的完整步骤' },
  { key: 'features', icon: '🗺️', label: '功能总览', desc: '产品包含哪些功能' },
  { key: 'pageflow', icon: '📄', label: '页面流程', desc: '点击按钮后跳转到哪里' },
  { key: 'dataflow', icon: '💾', label: '数据流', desc: '数据从哪来到哪去', dev: false },
  { key: 'tech', icon: '⚙️', label: '技术关系', desc: '文件与文件的依赖关系', dev: true },
];

export function Sidebar() {
  const { views, activeView, setActiveView, devMode, selectedNodeId, selectNode, generatingViews, generateViews, refreshViews, staleNodeIds, meta } = useApp();

  const currentView = activeView === 'tech' ? null : views?.views.find(v => v.kind === activeView);

  return (
    <nav className="sidebar" aria-label="视图与目录">
      <div className="section-label">视图</div>
      {VIEW_META.filter(v => !v.dev || devMode).map(v => (
        <button key={v.key} className={`view-tab ${activeView === v.key ? 'active' : ''}`}
          onClick={() => setActiveView(v.key)}>
          <span aria-hidden>{v.icon}</span>
          <span>
            <div>{v.label}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{v.desc}</div>
          </span>
        </button>
      ))}

      {views && staleNodeIds.size > 0 && (
        <button style={{ width: '100%', fontSize: 12, marginTop: 8, borderColor: 'var(--amber)', color: 'var(--amber)' }}
          onClick={() => void refreshViews()} disabled={generatingViews}
          title="只重新生成受代码变化影响的部分，比整图重新生成节省很多">
          {generatingViews ? <><span className="spin" /> 刷新中…</> : `🔄 刷新过期内容（${staleNodeIds.size} 个节点）`}
        </button>
      )}
      {views && (
        <button className="ghost" style={{ width: '100%', fontSize: 11, marginTop: 4, color: 'var(--ink-3)' }}
          onClick={() => void generateViews()} disabled={generatingViews}
          title="代码变化较大时可以重新生成所有视图">
          {generatingViews ? <><span className="spin" /> 生成中…</> : '↻ 重新生成所有视图'}
        </button>
      )}

      {currentView && currentView.nodes.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 20 }}>当前视图目录</div>
          {currentView.nodes.map(n => (
            <button key={n.id} className={`view-tab ${selectedNodeId === n.id ? 'active' : ''}`}
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={() => selectNode(n.id)}>
              {n.icon && <span aria-hidden style={{ fontSize: 12 }}>{n.icon}</span>}
              <span>{n.title}</span>
            </button>
          ))}
        </>
      )}

      {views?.projectSummary && (
        <>
          <div className="section-label" style={{ marginTop: 20 }}>项目简介</div>
          <p style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7 }}>{views.projectSummary}</p>
        </>
      )}

      {meta && (
        <p style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 16 }} className="mono">
          {meta.fileCount} 文件 · v{meta.analysisVersion}
          {meta.gitCommit && <> · {meta.gitCommit.slice(0, 7)}</>}
          <br />
          {meta.analyzedAt && `分析于 ${new Date(meta.analyzedAt).toLocaleTimeString('zh-CN')}`}
        </p>
      )}
    </nav>
  );
}
