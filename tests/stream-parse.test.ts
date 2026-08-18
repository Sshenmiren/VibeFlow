import { describe, expect, it } from 'vitest';
import { parseStreamEvent } from '../server/ai/claudeCli.ts';

describe('claude stream-json 事件 → 用户可读进度', () => {
  it('Read 工具调用 → 阅读文件（只显示文件名）', () => {
    const line = parseStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:\\proj\\frontend\\src\\pages\\MainMenu.tsx' } }] },
    });
    expect(line).toBe('🔍 阅读 MainMenu.tsx');
  });

  it('Edit 工具调用 → 修改文件', () => {
    const line = parseStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/App.tsx' } }] },
    });
    expect(line).toBe('✏️ 修改 App.tsx');
  });

  it('Write 工具调用 → 创建/写入文件', () => {
    const line = parseStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'src/new/DiceModal.tsx' } }] },
    });
    expect(line).toBe('✏️ 写入 DiceModal.tsx');
  });

  it('Grep/Glob → 搜索', () => {
    expect(parseStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'onNewGame' } }] },
    })).toBe('🔎 搜索 onNewGame');
    expect(parseStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Glob', input: { pattern: '**/*.tsx' } }] },
    })).toBe('🔎 搜索 **/*.tsx');
  });

  it('assistant 文字 → 显示前 60 字', () => {
    const line = parseStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '我先看一下主菜单的结构，然后在标题下方加入副标题。' }] },
    });
    expect(line).toBe('💬 我先看一下主菜单的结构，然后在标题下方加入副标题。');
  });

  it('system/user/result 等事件 → null（不展示）', () => {
    expect(parseStreamEvent({ type: 'system', subtype: 'init' })).toBeNull();
    expect(parseStreamEvent({ type: 'user', message: { content: [] } })).toBeNull();
    expect(parseStreamEvent({ type: 'result', subtype: 'success' })).toBeNull();
  });

  it('空文字/未知内容 → null', () => {
    expect(parseStreamEvent({ type: 'assistant', message: { content: [{ type: 'text', text: '  ' }] } })).toBeNull();
    expect(parseStreamEvent({ nonsense: true })).toBeNull();
  });
});
