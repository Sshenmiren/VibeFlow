import { describe, expect, it, beforeAll } from 'vitest';
import { extractFacts } from '../server/parser/extract.ts';
import { initParsers } from '../server/parser/treesitter.ts';

beforeAll(async () => {
  await initParsers();
});

describe('TS/TSX 提取', () => {
  it('提取 import 与符号', () => {
    const src = `
import { useState } from 'react';
import api, { fetchGame } from './api/client';
import * as utils from '../utils';

export function GameView() {
  const [state, setState] = useState(null);
  return <div onClick={() => fetchGame()}>{state}</div>;
}

export const useGame = () => { return fetchGame(); };

function helper(a: number) { return a + 1; }

export class Engine {
  run() { helper(1); }
}
`;
    const { imports, symbols } = extractFacts('src/GameView.tsx', 'tsx', src);

    expect(imports).toHaveLength(3);
    expect(imports[0]).toMatchObject({ specifier: 'react', names: ['useState'] });
    expect(imports[1]).toMatchObject({ specifier: './api/client', names: ['default', 'fetchGame'] });
    expect(imports[2].names).toContain('*');

    const byName = Object.fromEntries(symbols.map(s => [s.name, s]));
    expect(byName.GameView.kind).toBe('component');
    expect(byName.GameView.exported).toBe(true);
    expect(byName.GameView.calls).toContain('fetchGame');
    expect(byName.useGame.kind).toBe('hook');
    expect(byName.helper.kind).toBe('function');
    expect(byName.helper.exported).toBe(false);
    expect(byName.Engine.kind).toBe('class');
  });

  it('识别 Express 路由', () => {
    const src = `app.get('/api/health', (req, res) => { res.json({ok: true}); });`;
    const { symbols } = extractFacts('server.js', 'js', src);
    expect(symbols[0]).toMatchObject({ kind: 'route', route: 'GET /api/health' });
  });
});

describe('Python 提取', () => {
  it('提取 import 与函数/类', () => {
    const src = `
from fastapi import FastAPI
from .engine import combat_engine
import json

app = FastAPI()

@app.post("/api/game/start")
def start_game(req: StartRequest):
    state = combat_engine.init()
    return state

class GameManager:
    def reset(self):
        self.load()
`;
    const { imports, symbols } = extractFacts('backend/main.py', 'python', src);

    expect(imports.map(i => i.specifier)).toEqual(['fastapi', '.engine', 'json']);
    expect(imports[1].names).toContain('combat_engine');

    const route = symbols.find(s => s.kind === 'route');
    expect(route).toBeDefined();
    expect(route!.route).toBe('POST /api/game/start');
    expect(route!.name).toBe('start_game');
    expect(route!.calls).toContain('init');

    const cls = symbols.find(s => s.name === 'GameManager');
    expect(cls?.kind).toBe('class');
  });
});
