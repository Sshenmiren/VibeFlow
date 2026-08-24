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
  const shift = d.labelShift ?? 0;

  // 反向边对：让两条边的拐弯点落在不同位置（stepPosition 0.36 / 0.64），
  // 这样它们本身就是两条可区分的折线，标签各自落在自己路径的中点，天然分开。
  // 不能沿直线 source→target 推标签：smoothstep 是直角折线，那样会把标签
  // 推到别的线旁边（看起来像标错了线）。
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: d.borderRadius ?? 14,
    offset: d.offset ?? 20,
    ...(shift !== 0 ? { stepPosition: shift < 0 ? 0.36 : 0.64 } : {}),
  });

  // 再沿垂直路径方向微调，确保贴住本条线又不与对向标签相撞
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const across = shift * 22;
  const lx = labelX + (-dy / len) * across;
  const ly = labelY + (dx / len) * across;

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
