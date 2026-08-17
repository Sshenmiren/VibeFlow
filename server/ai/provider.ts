import { getSettings } from '../store.ts';
import { ClaudeCliProvider } from './claudeCli.ts';
import { OpenAICompatProvider } from './openaiCompat.ts';

export interface GenOptions {
  prompt: string;
  /** 追加的系统性约束（拼进 prompt 开头） */
  system?: string;
  model?: string;
  /** 在哪个目录运行（修改代码时=目标项目根） */
  cwd?: string;
  /** 允许 AI 编辑文件（仅 claude-cli 修改流程用） */
  allowEdits?: boolean;
  /** 续接已有会话（省 token） */
  resumeSession?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface GenResult {
  text: string;
  costUsd: number;
  sessionId?: string;
  isError: boolean;
  errorMessage?: string;
}

export interface AiProvider {
  name: string;
  generate(opts: GenOptions): Promise<GenResult>;
}

export function getProvider(): AiProvider {
  const s = getSettings();
  if (s.provider === 'openai-compat') return new OpenAICompatProvider(s);
  return new ClaudeCliProvider(s);
}

/** 从 AI 输出中提取 JSON（容忍 ```json 围栏和前后闲话） */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('AI 输出中找不到 JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}
