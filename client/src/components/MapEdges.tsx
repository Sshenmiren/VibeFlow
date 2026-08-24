import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

/**
 * 业务连线：在 smoothstep 基础上把标签沿路径挪开。
 *
 * 为什么需要自定义：React Flow 内置边把标签固定放在路径中点，
 * 一对互为反向的边（A→B 与 B→A，如"按C键加速"/"再按C键减速"）中点几乎重合，
 * 后画的会把前一个完全盖住，只看得见一段文字。
 * 这里用 data.labelShift（-1 / +1）把两条边的标签分别往两端推开。
 */
export function BizEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  label, labelStyle, labelBgStyle, style, markerEnd, data,
}: EdgeProps) {
  const d = (data ?? {}) as { labelShift?: number; borderRadius?: number; offset?: number };
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: d.borderRadius ?? 14,
    offset: d.offset ?? 20,
  });

  // 反向边对的标签同时做两件事才真正分开：
  //   1) 沿路径方向前后错开（避免落在同一中点）
  //   2) 垂直路径方向左右错开（各自贴住自己那条线，不会挤在一起）
  const shift = d.labelShift ?? 0;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const along = shift === 0 ? 0 : shift * Math.max(40, Math.min(96, len * 0.3));
  const across = shift * 13;
  const lx = labelX + (dx / len) * along + (-dy / len) * across;
  const ly = labelY + (dy / len) * along + (dx / len) * across;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="biz-edge-label nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
              ...(labelBgStyle as React.CSSProperties),
              ...(labelStyle as React.CSSProperties),
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { biz: BizEdge };
