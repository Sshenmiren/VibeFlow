import { useApp } from '../store.ts';

const KIND_ICON: Record<string, string> = {
  'import': '📥', 'analysis': '🔍', 'files-changed': '✏️',
  'views-generated': '🗺️', 'modify': '🤖', 'note': '📌',
};

/** 底部航行日志：AI 和你刚刚做了什么 */
export function Timeline() {
  const { timeline } = useApp();
  if (timeline.length === 0) return null;

  return (
    <footer className="timeline-strip" aria-label="项目变化时间线">
      <div className="section-label" style={{ padding: '6px 16px 0', margin: 0 }}>航行日志 · 刚刚发生了什么</div>
      <div style={{ overflowY: 'auto', padding: '4px 16px 10px' }}>
        {timeline.slice(0, 30).map(e => (
          <div key={e.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', borderBottom: '1px dashed var(--line)' }}>
            <span aria-hidden>{KIND_ICON[e.kind] ?? '·'}</span>
            <span style={{ color: 'var(--ink-3)', flexShrink: 0 }} className="mono">
              {new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span style={{ fontWeight: 500, flexShrink: 0 }}>{e.title}</span>
            {e.detail && <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.detail}</span>}
            {e.costUsd != null && e.costUsd > 0 && <span style={{ color: 'var(--ink-3)', marginLeft: 'auto', flexShrink: 0 }} className="mono">${e.costUsd.toFixed(3)}</span>}
          </div>
        ))}
      </div>
    </footer>
  );
}
