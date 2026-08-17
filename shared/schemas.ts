import { z } from 'zod';

/** AI 输出的结构校验 —— 不信任任何自由格式文本 */

export const SourceRefSchema = z.object({
  file: z.string().min(1),
  symbol: z.string().optional(),
});

export const BizNodeSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(40),
  summary: z.string().min(1).max(200),
  sourceRefs: z.array(SourceRefSchema).min(1).max(8),
  group: z.string().max(30).optional(),
  icon: z.string().max(8).optional(),
});

export const BizEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  label: z.string().max(40).optional(),
});

export const BizViewSchema = z.object({
  kind: z.enum(['journey', 'features', 'pageflow', 'dataflow']),
  title: z.string().min(1).max(30),
  nodes: z.array(BizNodeSchema).min(1).max(30),
  edges: z.array(BizEdgeSchema).max(60),
});

export const ViewsPayloadSchema = z.object({
  projectSummary: z.string().min(10).max(600),
  views: z.array(BizViewSchema).min(4).max(4),
});
export type ViewsPayload = z.infer<typeof ViewsPayloadSchema>;

export const ExplanationSchema = z.object({
  nodeId: z.string(),
  what: z.string().min(1).max(400),
  when: z.string().min(1).max(300),
  inputs: z.string().min(1).max(300),
  outputs: z.string().min(1).max(300),
  onError: z.string().min(1).max(300),
  dependsOn: z.string().min(1).max(300),
  impact: z.string().min(1).max(400),
  pseudocode: z.array(z.string().max(120)).min(1).max(12),
});
export type ExplanationPayload = z.infer<typeof ExplanationSchema>;

export const ExplanationBatchSchema = z.object({
  explanations: z.array(ExplanationSchema).min(1),
});
