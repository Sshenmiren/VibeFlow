import { useCallback, useEffect, useState } from 'react';
import { useApp } from './store.ts';
import { Landing } from './components/Landing.tsx';
import { TopBar } from './components/TopBar.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { MapCanvas } from './components/MapCanvas.tsx';
import { BuilderCanvas } from './components/BuilderCanvas.tsx';
import { DetailPanel } from './components/DetailPanel.tsx';
import { Timeline } from './components/Timeline.tsx';

export default function App() {
  const { meta, openProject, closeProject, selectedNodeId, selectNode, toast, showToast, activeView } = useApp();
  const [loading, setLoading] = useState(false);

  const handleOpen = useCallback((id: string) => {
    setLoading(true);
    openProject(id)
      .catch((err: Error) => showToast(err.message, 'error'))
      .finally(() => setLoading(false));
    // 记住上次打开的项目，刷新页面自动恢复
    localStorage.setItem('wdad:last-project', id);
  }, [openProject, showToast]);

  useEffect(() => {
    const last = localStorage.getItem('wdad:last-project');
    if (last) handleOpen(last);
  }, [handleOpen]);

  // 键盘：Esc 关闭详情
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedNodeId) selectNode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, selectNode]);

  if (!meta) {
    return (
      <>
        {loading ? (
          <div className="paper-bg" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p><span className="spin" /> 正在打开项目…</p>
          </div>
        ) : (
          <Landing onOpen={handleOpen} />
        )}
        {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
      </>
    );
  }

  const hasRightPanel = activeView === 'builder' || selectedNodeId != null;
  return (
    <div className={`shell ${hasRightPanel ? '' : 'no-detail'}`}>
      <TopBar onHome={() => { closeProject(); localStorage.removeItem('wdad:last-project'); }} />
      <Sidebar />
      {activeView === 'builder' ? <BuilderCanvas /> : <MapCanvas />}
      {selectedNodeId && activeView !== 'builder' && <DetailPanel />}
      <Timeline />
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </div>
  );
}
