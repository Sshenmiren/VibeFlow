import { useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../store.ts';

export function TopBar({ onHome }: { onHome: () => void }) {
  const { meta, devMode, setDevMode, settings, refreshSettings, showToast } = useApp();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <header className="topbar">
      <button className="ghost serif" style={{ fontSize: 16, fontWeight: 900 }} onClick={onHome} title="回到项目选择">
        📜 whatdidaido
      </button>
      {meta && (
        <>
          <span style={{ color: 'var(--line-strong)' }}>/</span>
          <h1 style={{ fontSize: 15, margin: 0 }}>{meta.name}</h1>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{meta.techStack.slice(0, 5).join(' · ')}</span>
        </>
      )}

      <div className="mode-toggle" role="group" aria-label="模式切换">
        <button className={devMode ? '' : 'on'} onClick={() => setDevMode(false)} aria-pressed={!devMode}>小白模式</button>
        <button className={devMode ? 'on' : ''} onClick={() => setDevMode(true)} aria-pressed={devMode}>开发者模式</button>
      </div>

      {settings && (
        <button className="ghost mono" style={{ fontSize: 11 }} onClick={() => setShowSettings(s => !s)} title="AI 设置与累计成本">
          {settings.provider === 'claude-cli' ? 'claude' : 'api'}:{settings.model} · ${settings.totalCostUsd.toFixed(2)}
        </button>
      )}

      {showSettings && settings && (
        <div style={{
          position: 'absolute', top: 54, right: 12, zIndex: 50, background: 'var(--card)',
          border: '1.5px solid var(--ink)', borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: 16, width: 300,
        }}>
          <div className="section-label" style={{ marginTop: 0 }}>AI 引擎</div>
          <select className="mono" style={{ width: '100%', padding: 6, fontSize: 12 }}
            value={settings.provider}
            onChange={e => {
              void api.saveSettings({ provider: e.target.value as 'claude-cli' | 'openai-compat' })
                .then(() => refreshSettings())
                .catch((err: Error) => showToast(err.message, 'error'));
            }}>
            <option value="claude-cli">claude CLI（本机，支持修改代码）</option>
            <option value="openai-compat">OpenAI 兼容 API（仅解释/问答）</option>
          </select>
          <div className="section-label">模型</div>
          <input className="mono" style={{ width: '100%', fontSize: 12 }} defaultValue={settings.model}
            onBlur={e => {
              if (e.target.value !== settings.model) {
                void api.saveSettings({ model: e.target.value }).then(() => refreshSettings());
              }
            }} />
          <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            claude CLI 可填 haiku / sonnet / opus。<br />
            累计 AI 花费：${settings.totalCostUsd.toFixed(4)}<br />
            省钱机制：解释按需生成并永久缓存，代码没变不重复调用。
          </p>
          {settings.provider === 'openai-compat' && (
            <>
              <div className="section-label">Base URL</div>
              <input className="mono" style={{ width: '100%', fontSize: 12 }} defaultValue={settings.openaiBaseUrl ?? ''}
                placeholder="https://api.example.com/v1"
                onBlur={e => void api.saveSettings({ openaiBaseUrl: e.target.value }).then(() => refreshSettings())} />
              <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>API Key 请设在服务端环境变量 OPENAI_API_KEY（不会出现在浏览器里）。</p>
            </>
          )}
        </div>
      )}
    </header>
  );
}
