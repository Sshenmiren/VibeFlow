import { useEffect, useState } from 'react';
import { api } from '../api.ts';

export function Landing({ onOpen }: { onOpen: (id: string) => void }) {
  const [path, setPath] = useState('');
  const [recent, setRecent] = useState<{ id: string; path: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.registry().then(setRecent).catch(() => setRecent([]));
  }, []);

  const importProject = async (p: string) => {
    if (!p.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const meta = await api.importProject(p.trim());
      onOpen(meta.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="paper-bg" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="fade-in" style={{ width: 560, maxWidth: '90vw' }}>
        <h1 className="serif" style={{ fontSize: 42, fontWeight: 900, margin: 0, letterSpacing: '0.02em' }}>
          📜 whatdidaido
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-2)', marginTop: 6 }}>
          把你的软件项目转换成<strong style={{ color: 'var(--cinnabar)' }}>可视化的项目视图</strong>。<br />
          AI（比如 Claude Code）改了什么、项目怎么运作、想改哪里——一目了然。
        </p>

        <div style={{ background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: 10, padding: 20, boxShadow: 'var(--shadow-lg)', marginTop: 18 }}>
          <label htmlFor="path-input" style={{ fontWeight: 500, fontSize: 13 }}>项目文件夹的完整路径</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input id="path-input" className="mono" style={{ flex: 1, fontSize: 12 }}
              placeholder="C:\Users\你\Desktop\my-project（空文件夹也行）"
              value={path}
              onChange={e => setPath(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void importProject(path); }} />
            <button className="primary" onClick={() => void importProject(path)} disabled={busy || !path.trim()}>
              {busy ? <><span className="spin" /> 导入中…</> : '打开项目'}
            </button>
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 0 }}>{error}</p>}
          <p style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 0 }}>
            分析在本机完成；如果文件夹还不是 Git 仓库会自动初始化一个（用于安全回滚）。<br />
            <strong>从零开始？</strong>指向一个空文件夹，然后开始写代码，项目视图会实时更新。
          </p>
        </div>

        {recent.length > 0 && (
          <>
            <div className="section-label">最近打开</div>
            {recent.map(r => (
              <button key={r.id} className="ghost" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px' }}
                onClick={() => void importProject(r.path)}>
                <strong>{r.name}</strong>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 8 }}>{r.path}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
