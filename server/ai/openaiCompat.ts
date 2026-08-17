import type { AiSettings } from '../../shared/types.ts';
import type { AiProvider, GenOptions, GenResult } from './provider.ts';

/**
 * OpenAI 兼容 API（本地模型 / 任意中转）。
 * Key 只从服务端环境变量读取（OPENAI_API_KEY），绝不下发前端。
 * 注意：此 Provider 只能做文本生成（解释/问答/视图），不能执行代码修改 ——
 * 修改流程需要 agent 能力，仅 claude-cli 支持。
 */
export class OpenAICompatProvider implements AiProvider {
  name = 'openai-compat';
  constructor(private settings: AiSettings) {}

  async generate(opts: GenOptions): Promise<GenResult> {
    if (opts.allowEdits) {
      return {
        text: '', costUsd: 0, isError: true,
        errorMessage: 'OpenAI 兼容模式不支持代码修改（需要 claude-cli），请在设置中切换 Provider',
      };
    }
    const baseUrl = this.settings.openaiBaseUrl ?? process.env.OPENAI_BASE_URL;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!baseUrl) return { text: '', costUsd: 0, isError: true, errorMessage: '未配置 OPENAI_BASE_URL' };

    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: opts.model ?? this.settings.model,
          messages: [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            { role: 'user', content: opts.prompt },
          ],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 4 * 60_000),
      });
      if (!res.ok) {
        return { text: '', costUsd: 0, isError: true, errorMessage: `API ${res.status}: ${(await res.text()).slice(0, 300)}` };
      }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content ?? '';
      return { text, costUsd: 0, isError: !text, errorMessage: text ? undefined : 'API 返回为空' };
    } catch (err) {
      return { text: '', costUsd: 0, isError: true, errorMessage: `请求失败：${(err as Error).message}` };
    }
  }
}
