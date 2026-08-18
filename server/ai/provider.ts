import { jsonrepair } from 'jsonrepair';
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
  /** 实时进度回调（设置后走 stream-json，AI 每个动作都会上报一行） */
  onProgress?: (line: string) => void;
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

/** 从 AI 输出中提取 JSON（容忍 ```json 围栏、前后闲话、未转义引号等常见毛病） */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('AI 输出中找不到 JSON');
  const raw = candidate.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    // 模型常见的 JSON 毛病（字符串里的英文引号、尾逗号…）交给 jsonrepair
    return JSON.parse(jsonrepair(raw));
  }
}
