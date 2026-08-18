import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BizNode, TechNode, ViewKind } from '../../../shared/types.ts';

/** 业务节点卡片（旅程/功能/页面/数据流共用，样式按视图区分）。手柄悬停可见，可与新构想连线。 */
export function BizNodeCard({ data }: NodeProps) {
  const d = data as { biz: BizNode; viewKind: ViewKind; step?: number; stale: boolean; selected: boolean };
  const { biz, viewKind, step, stale, selected } = d;
  return (
    <div className={`map-node ${viewKind} ${stale ? 'stale' : ''} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="biz-handle" />
      {viewKind === 'features' && biz.group && <span className="group-tag">{biz.group}</span>}
      <div className="node-title">
        {viewKind === 'journey' && step != null && <span className="step-badge">{step}</span>}
        {biz.icon && <span aria-hidden>{biz.icon}</span>}
        <span>{biz.title}</span>
      </div>
      <div className="node-summary">{biz.summary}</div>
      <Handle type="source" position={Position.Right} className="biz-handle" />
    </div>
  );
}

/** 新建模块草稿节点：直接画在业务视图上，标题和说明都由用户自己写 */
export function DraftNode({ id, data, selected }: NodeProps) {
  const d = data as {
    title: string; desc: string;
    onChange: (id: string, patch: { title?: string; desc?: string }) => void;
    onDelete: (id: string) => void;
  };
  return (
    <div className={`map-node draft ${selected ? 'selected' : ''}`} style={{ minWidth: 190, maxWidth: 230 }}>
      <Handle type="target" position={Position.Left} className="draft-handle" />
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span aria-hidden>＋</span>
        <input
          className="nodrag"
          style={{ flex: 1, fontFamily: 'var(--serif)', fontWeight: 600, fontSize: 13, border: 'none', background: 'transparent', padding: '2px 0' }}
          placeholder="模块名称…"
          value={d.title}
          onChange={e => d.onChange(id, { title: e.target.value })}
          aria-label="模块名称"
        />
        <button className="ghost nodrag" style={{ padding: '0 5px', fontSize: 12 }} title="删除此模块"
          onClick={() => d.onDelete(id)}>✕</button>
      </div>
      <textarea
        className="nodrag nowheel"
        rows={2}
        style={{ width: '100%', fontSize: 12, border: '1px dashed var(--cinnabar)', background: 'var(--cinnabar-soft)', marginTop: 4, resize: 'none' }}
        placeholder="这个模块应该做什么…"
        value={d.desc}
        onChange={e => d.onChange(id, { desc: e.target.value })}
        aria-label="模块说明"
      />
      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 3 }}>拖手柄连接到现有节点 ⇄</div>
      <Handle type="source" position={Position.Right} className="draft-handle" />
    </div>
  );
}

/** 技术视图：文件节点 */
export function TechFileNode({ data }: NodeProps) {
  const d = data as { tech: TechNode; stale: boolean; selected: boolean };
  const { tech, stale, selected } = d;
  return (
    <div className={`map-node tech-file ${stale ? 'stale' : ''} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="node-title">{tech.label}</div>
      <div className="node-summary mono" style={{ fontSize: 10 }}>
        {tech.symbolCount ? `${tech.symbolCount} 个符号` : ''}
        {tech.tags?.length ? ` · ${tech.tags.join(' ')}` : ''}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

/** 技术视图：文件夹容器 */
export function FolderNode({ data }: NodeProps) {
  const d = data as { label: string };
  return (
    <div className="tech-folder" style={{ width: '100%', height: '100%' }}>
      <div className="folder-label">📁 {d.label}</div>
    </div>
  );
}

export const nodeTypes = {
  biz: BizNodeCard,
  techFile: TechFileNode,
  folder: FolderNode,
  draft: DraftNode,
};
