import { spawn } from 'node:child_process';
import type { AiSettings } from '../../shared/types.ts';
import { addCost } from '../store.ts';
import type { AiProvider, GenOptions, GenResult } from './provider.ts';

interface CliResult {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  session_id?: string;
  subtype?: string;
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
    const args = ['-p', '--output-format', 'json', '--setting-sources', 'project'];
    const model = opts.model ?? this.settings.model;
    if (model) args.push('--model', model);
    if (opts.resumeSession) args.push('--resume', opts.resumeSession);
    if (opts.allowEdits) {
      args.push('--permission-mode', 'acceptEdits');
      args.push('--max-turns', String(opts.maxTurns ?? 40));
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
      const timer = setTimeout(() => {
        child.kill();
        resolve({ text: '', costUsd: 0, isError: true, errorMessage: `AI 调用超时（${timeoutMs / 1000}s）` });
      }, timeoutMs);

      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.stdin.write(prompt);
      child.stdin.end();

      child.on('close', (code) => {
        clearTimeout(timer);
        let parsed: CliResult | null = null;
        try {
          const jsonStart = stdout.indexOf('{');
          parsed = JSON.parse(stdout.slice(jsonStart)) as CliResult;
        } catch { /* 输出不是 JSON */ }

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
