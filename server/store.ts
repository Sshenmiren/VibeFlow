import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type {
  AiSettings, Blueprint, BusinessViews, ChangeSet, CheckBaseline, FileFact, NodeExplanation,
  ProjectMeta, TimelineEvent, ViewLayouts,
} from '../shared/types.ts';

// ---------- 通用 JSON 读写（原子写） ----------

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  fs.renameSync(tmp, file);
}

// ---------- 全局：项目注册表 + 设置（存用户目录） ----------

const HOME_DIR = path.join(os.homedir(), '.whatdidaido');
const REGISTRY_FILE = path.join(HOME_DIR, 'registry.json');
const SETTINGS_FILE = path.join(HOME_DIR, 'settings.json');

export function projectIdFor(absPath: string): string {
  return crypto.createHash('sha1').update(path.resolve(absPath).toLowerCase()).digest('hex').slice(0, 12);
}

export function listRegistry(): { id: string; path: string; name: string }[] {
  return readJson(REGISTRY_FILE, [] as { id: string; path: string; name: string }[]);
}

export function addToRegistry(entry: { id: string; path: string; name: string }) {
  const reg = listRegistry().filter(r => r.id !== entry.id);
  reg.unshift(entry);
  writeJson(REGISTRY_FILE, reg.slice(0, 20));
}

export function getSettings(): AiSettings {
  return readJson(SETTINGS_FILE, {
    provider: 'claude-cli',
    model: 'sonnet',
    totalCostUsd: 0,
  } as AiSettings);
}

export function saveSettings(s: AiSettings) {
  writeJson(SETTINGS_FILE, s);
}

export function addCost(usd: number) {
  const s = getSettings();
  s.totalCostUsd = Math.round((s.totalCostUsd + usd) * 10000) / 10000;
  saveSettings(s);
  return s.totalCostUsd;
}

// ---------- 每项目存储（存目标项目 .whatdidaido/ 下，刷新页面不丢） ----------

export class ProjectStore {
  readonly dir: string;
  constructor(readonly projectRoot: string) {
    this.dir = path.join(projectRoot, '.whatdidaido');
  }

  private file(name: string) { return path.join(this.dir, name); }

  getMeta(): ProjectMeta | null { return readJson<ProjectMeta | null>(this.file('meta.json'), null); }
  saveMeta(m: ProjectMeta) { writeJson(this.file('meta.json'), m); }

  getFiles(): Record<string, FileFact> { return readJson(this.file('files.json'), {}); }
  saveFiles(files: Record<string, FileFact>) { writeJson(this.file('files.json'), files); }

  getViews(): BusinessViews | null { return readJson<BusinessViews | null>(this.file('views.json'), null); }
  saveViews(v: BusinessViews) { writeJson(this.file('views.json'), v); }

  getExplanations(): Record<string, NodeExplanation> { return readJson(this.file('explanations.json'), {}); }
  saveExplanations(e: Record<string, NodeExplanation>) { writeJson(this.file('explanations.json'), e); }

  getChangeSets(): ChangeSet[] { return readJson(this.file('changesets.json'), [] as ChangeSet[]); }
  saveChangeSets(c: ChangeSet[]) { writeJson(this.file('changesets.json'), c); }

  getTimeline(): TimelineEvent[] { return readJson(this.file('timeline.json'), [] as TimelineEvent[]); }

  addTimelineEvent(e: Omit<TimelineEvent, 'id' | 'at'>): TimelineEvent {
    const timeline = this.getTimeline();
    const event: TimelineEvent = { ...e, id: crypto.randomUUID().slice(0, 8), at: new Date().toISOString() };
    timeline.unshift(event);
    writeJson(this.file('timeline.json'), timeline.slice(0, 300));
    return event;
  }

  /** 节点问答的 claude 会话续接（省 token） */
  getSessions(): Record<string, string> { return readJson(this.file('sessions.json'), {}); }
  saveSessions(s: Record<string, string>) { writeJson(this.file('sessions.json'), s); }

  /** 构建蓝图（用户自由画布） */
  getBlueprint(): Blueprint { return readJson(this.file('blueprint.json'), { blocks: [], connections: [], updatedAt: '' } as Blueprint); }
  saveBlueprint(b: Blueprint) { writeJson(this.file('blueprint.json'), b); }

  /** 用户拖动后的节点位置 */
  getLayouts(): ViewLayouts { return readJson(this.file('layouts.json'), {}); }
  saveLayouts(l: ViewLayouts) { writeJson(this.file('layouts.json'), l); }

  /** 待处理的过期信息：自上次视图生成/刷新以来变化的文件与受影响节点（服务端持久化，刷新页面不丢标记） */
  getPendingStale(): { files: string[]; nodeIds: string[] } {
    return readJson(this.file('pending-stale.json'), { files: [], nodeIds: [] });
  }
  addPendingStale(files: string[], nodeIds: string[]) {
    const cur = this.getPendingStale();
    writeJson(this.file('pending-stale.json'), {
      files: [...new Set([...cur.files, ...files])],
      nodeIds: [...new Set([...cur.nodeIds, ...nodeIds])],
    });
  }
  clearPendingStale() {
    writeJson(this.file('pending-stale.json'), { files: [], nodeIds: [] });
  }

  /** 各 commit 的检查基线（区分"本来就挂"和"新弄挂的"） */
  getBaseline(commit: string): CheckBaseline | null {
    const all = readJson<Record<string, CheckBaseline>>(this.file('baselines.json'), {});
    return all[commit] ?? null;
  }
  saveBaseline(commit: string, baseline: CheckBaseline) {
    const all = readJson<Record<string, CheckBaseline>>(this.file('baselines.json'), {});
    all[commit] = baseline;
    // 只留最近 20 个 commit 的基线
    const keys = Object.keys(all);
    if (keys.length > 20) for (const k of keys.slice(0, keys.length - 20)) delete all[k];
    writeJson(this.file('baselines.json'), all);
  }
}

export function contentHash(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 16);
}
