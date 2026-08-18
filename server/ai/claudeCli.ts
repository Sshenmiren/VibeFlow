import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AiSettings } from '../../shared/types.ts';
import { addCost } from '../store.ts';
import type { AiProvider, GenOptions, GenResult } from './provider.ts';

/** 修改会话的安全护栏：禁止 AI 读取目标项目里的密钥文件 */
const GUARD_DENY = [
  'Read(./.env)', 'Read(./.env.*)', 'Read(**/.env)', 'Read(**/.env.*)',
  'Read(**/credentials*)', 'Read(**/*.pem)', 'Read(**/*secret*)',
];

/**
 * 把 deny 规则合并进目标项目的 .claude/settings.local.json ——
 * 它属于 project 级配置，会被 --setting-sources project 自然加载。
 * （不能用 --settings 标志：部分 API 代理会因此拒绝请求）
 * 只做并集合并，绝不覆盖项目里已有的其他配置。
 */
function ensureGuardSettings(cwd: string): void {
  const file = path.join(cwd, '.claude', 'settings.local.json');
  let existing: { permissions?: { deny?: string[] } & Record<string, unknown> } & Record<string, unknown> = {};
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 没有或坏了 → 新建 */ }
  const deny = [...new Set([...(existing.permissions?.deny ?? []), ...GUARD_DENY])];
  const merged = { ...existing, permissions: { ...existing.permissions, deny } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 1));
}

interface CliResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  session_id?: string;
  subtype?: string;
}

/** stream-json 事件 → 用户可读进度行；不值得展示的事件返回 null */
export function parseStreamEvent(event: unknown): string | null {
  const e = event as { type?: string; message?: { content?: { type: string; name?: string; text?: string; input?: Record<string, unknown> }[] } };
  if (e?.type !== 'assistant' || !Array.isArray(e.message?.content)) return null;
  for (const item of e.message.content) {
    if (item.type === 'tool_use' && item.name) {
      const input = item.input ?? {};
      const file = String(input.file_path ?? input.notebook_path ?? '');
      const base = file ? file.split(/[\\/]/).pop() : '';
      switch (item.name) {
        case 'Read': return `🔍 阅读 ${base || '文件'}`;
        case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `✏️ 修改 ${base || '文件'}`;
        case 'Write': return `✏️ 写入 ${base || '文件'}`;
        case 'Grep': case 'Glob': return `🔎 搜索 ${String(input.pattern ?? '')}`.trimEnd();
        case 'Bash': return '⚙️ 运行命令';
        default: return `… ${item.name}`;
      }
    }
    if (item.type === 'text') {
      const text = (item.text ?? '').trim();
      if (text) return `💬 ${text.slice(0, 60)}`;
    }
  }
  return null;
}

/**
 * 通过本机 claude CLI（headless -p 模式）驱动。
 * 关键点：
 * - prompt 走 stdin，绕开 Windows 命令行引号地狱和长度限制
 * - --setting-sources project：跳过用户级全局配置（更便宜，也避免无关技能触发拦截）
 * - 成本从返回 JSON 的 total_cost_usd 累计
 */
export class ClaudeCliProvider implements AiProvider {
  name = 'claude-cli';
  constructor(private settings: AiSettings) {}

  generate(opts: GenOptions): Promise<GenResult> {
    const streaming = Boolean(opts.onProgress);
    const args = streaming
      ? ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project']
      : ['-p', '--output-format', 'json', '--setting-sources', 'project'];
    const model = opts.model ?? this.settings.model;
    if (model) args.push('--model', model);
    if (opts.resumeSession) args.push('--resume', opts.resumeSession);
    if (opts.allowEdits) {
      args.push('--permission-mode', 'acceptEdits');
      args.push('--max-turns', String(opts.maxTurns ?? 40));
      if (opts.cwd) ensureGuardSettings(opts.cwd);
    } else {
      args.push('--max-turns', String(opts.maxTurns ?? 1));
    }

    const prompt = opts.system ? `${opts.system}\n\n${opts.prompt}` : opts.prompt;
    const timeoutMs = opts.timeoutMs ?? (opts.allowEdits ? 15 * 60_000 : 4 * 60_000);

    return new Promise<GenResult>((resolve) => {
      // Node 对 .cmd 垫片强制要求 shell；参数全部无空格，安全
      const child = spawn('claude', args, {
        cwd: opts.cwd,
        shell: true,
        windowsHide: true,
        env: { ...process.env },
      });
      let stdout = '';
      let stderr = '';
      let streamBuffer = '';
      let streamResult: CliResult | null = null;
      const timer = setTimeout(() => {
        child.kill();
        resolve({ text: '', costUsd: 0, isError: true, errorMessage: `AI 调用超时（${timeoutMs / 1000}s）` });
      }, timeoutMs);

      child.stdout.on('data', (d: Buffer) => {
        const chunk = d.toString();
        if (!streaming) { stdout += chunk; return; }
        // 流式：逐行解析 NDJSON，进度实时上报，result 事件即最终结果
        streamBuffer += chunk;
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as CliResult & { type?: string };
            if (event.type === 'result') streamResult = event;
            else {
              const progress = parseStreamEvent(event);
              if (progress) opts.onProgress?.(progress);
            }
          } catch { /* 半截行，忽略 */ }
        }
      });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.stdin.write(prompt);
      child.stdin.end();

      child.on('close', (code) => {
        clearTimeout(timer);
        let parsed: CliResult | null = streamResult;
        if (!parsed) {
          try {
            const jsonStart = stdout.indexOf('{');
            parsed = JSON.parse(stdout.slice(jsonStart)) as CliResult;
          } catch { /* 输出不是 JSON */ }
        }

        const costUsd = parsed?.total_cost_usd ?? 0;
        if (costUsd > 0) addCost(costUsd);

        if (!parsed) {
          resolve({
            text: '', costUsd: 0, isError: true,
            errorMessage: `claude CLI 输出无法解析（exit ${code}）：${(stderr || stdout).slice(0, 400)}`,
          });
          return;
        }
        resolve({
          text: parsed.result ?? '',
          costUsd,
          sessionId: parsed.session_id,
          isError: Boolean(parsed.is_error),
          errorMessage: parsed.is_error ? (parsed.result ?? '未知错误').slice(0, 500) : undefined,
        });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ text: '', costUsd: 0, isError: true, errorMessage: `无法启动 claude CLI：${err.message}` });
      });
    });
  }
}
