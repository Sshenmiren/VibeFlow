import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { BizNode, TechNode, ViewKind } from '../../../shared/types.ts';

/** 业务节点卡片（旅程/功能/页面/数据流共用，样式按视图区分） */
export function BizNodeCard({ data }: NodeProps) {
  const d = data as { biz: BizNode; viewKind: ViewKind; step?: number; stale: boolean; selected: boolean };
  const { biz, viewKind, step, stale, selected } = d;
  return (
    <div className={`map-node ${viewKind} ${stale ? 'stale' : ''} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      {viewKind === 'features' && biz.group && <span className="group-tag">{biz.group}</span>}
      <div className="node-title">
        {viewKind === 'journey' && step != null && <span className="step-badge">{step}</span>}
        {biz.icon && <span aria-hidden>{biz.icon}</span>}
        <span>{biz.title}</span>
      </div>
      <div className="node-summary">{biz.summary}</div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
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
};
