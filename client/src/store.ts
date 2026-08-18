import { create } from 'zustand';
import type {
  AiSettings, AnalysisProgress, BusinessViews, ChangeSet, ProjectMeta,
  ServerEvent, TechGraph, TimelineEvent, ViewKind,
} from '../../shared/types.ts';
import { api, subscribeEvents } from './api.ts';

export type ActiveView = ViewKind | 'tech';

interface AppState {
  meta: ProjectMeta | null;
  views: BusinessViews | null;
  graph: TechGraph | null;
  timeline: TimelineEvent[];
  changesets: ChangeSet[];
  settings: AiSettings | null;

  activeView: ActiveView;
  selectedNodeId: string | null;
  devMode: boolean;
  staleNodeIds: Set<string>;
  analysisProgress: AnalysisProgress | null;
  generatingViews: boolean;
  toast: { text: string; kind: 'info' | 'error' } | null;
  /** 修改执行中的实时直播（csId → 进度行） */
  modifyLogs: Record<string, string[]>;
  /** 用户点了"放弃/好的"的构想修改单 */
  dismissedDraftCsId: string | null;
  dismissDraftCs: (id: string | null) => void;

  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  refreshAll: () => Promise<void>;
  setActiveView: (v: ActiveView) => void;
  selectNode: (id: string | null) => void;
  setDevMode: (on: boolean) => void;
  generateViews: () => Promise<void>;
  refreshViews: () => Promise<void>;
  showToast: (text: string, kind?: 'info' | 'error') => void;
  refreshSettings: () => Promise<void>;
  updateChangeSet: (cs: ChangeSet) => void;
}

let unsubscribe: (() => void) | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** 当前活跃的构想修改单（未接受/未回滚/未被用户放弃） */
export function selectActiveDraftCs(s: Pick<AppState, 'changesets' | 'dismissedDraftCsId'>) {
  return s.changesets.find(c =>
    c.nodeId === 'blueprint' && c.id !== s.dismissedDraftCsId && !['accepted', 'rolledback'].includes(c.status)) ?? null;
}

export const useApp = create<AppState>((set, get) => ({
  meta: null,
  views: null,
  graph: null,
  timeline: [],
  changesets: [],
  settings: null,
  activeView: 'journey',
  selectedNodeId: null,
  devMode: false,
  staleNodeIds: new Set(),
  analysisProgress: null,
  generatingViews: false,
  toast: null,
  modifyLogs: {},
  dismissedDraftCsId: null,
  dismissDraftCs(id) { set({ dismissedDraftCsId: id }); },

  async openProject(id: string) {
    unsubscribe?.();
    const [meta, settings, stale] = await Promise.all([
      api.project(id), api.settings(), api.stale(id).catch(() => ({ files: [], nodeIds: [] })),
    ]);
    set({ meta, settings, selectedNodeId: null, staleNodeIds: new Set(stale.nodeIds) });
    await get().refreshAll();

    unsubscribe = subscribeEvents(id, (e: ServerEvent) => {
      const s = get();
      switch (e.type) {
        case 'analysis:progress':
          set({ analysisProgress: e.progress.phase === 'done' ? null : e.progress });
          break;
        case 'analysis:done':
          set({ analysisProgress: null });
          void api.project(id).then(m => set({ meta: m }));
          void api.graph(id).then(g => set({ graph: g }));
          break;
        case 'files:changed': {
          const stale = new Set(s.staleNodeIds);
          for (const nid of e.staleNodeIds) stale.add(nid);
          set({ staleNodeIds: stale });
          void api.graph(id).then(g => set({ graph: g }));
          void api.project(id).then(m => set({ meta: m }));
          break;
        }
        case 'timeline':
          set({ timeline: [e.event, ...s.timeline].slice(0, 300) });
          break;
        case 'changeset':
          s.updateChangeSet(e.changeSet);
          break;
        case 'modify:log': {
          const logs = { ...s.modifyLogs };
          logs[e.csId] = [...(logs[e.csId] ?? []), e.line].slice(-120);
          set({ modifyLogs: logs });
          break;
        }
        case 'views:stale': {
          const stale = new Set(s.staleNodeIds);
          for (const nid of e.staleNodeIds) stale.add(nid);
          set({ staleNodeIds: stale });
          break;
        }
      }
    });
  },

  closeProject() {
    unsubscribe?.();
    unsubscribe = null;
    set({ meta: null, views: null, graph: null, timeline: [], changesets: [], selectedNodeId: null });
  },

  async refreshAll() {
    const id = get().meta?.id;
    if (!id) return;
    const [views, graph, timeline, changesets] = await Promise.all([
      api.views(id), api.graph(id), api.timeline(id), api.changesets(id),
    ]);
    set({ views, graph, timeline, changesets });
  },

  setActiveView(v) { set({ activeView: v, selectedNodeId: null }); },
  selectNode(id) { set({ selectedNodeId: id }); },
  setDevMode(on) {
    set({ devMode: on });
    if (!on && get().activeView === 'tech') set({ activeView: 'journey' });
  },

  async generateViews() {
    const id = get().meta?.id;
    if (!id) return;
    set({ generatingViews: true });
    try {
      const views = await api.generateViews(id);
      set({ views, staleNodeIds: new Set() });
      void get().refreshSettings();
    } catch (err) {
      get().showToast((err as Error).message, 'error');
    } finally {
      set({ generatingViews: false });
    }
  },

  /** 增量刷新：只重新翻译受变化影响的视图（比整图重生成便宜得多） */
  async refreshViews() {
    const id = get().meta?.id;
    if (!id) return;
    set({ generatingViews: true });
    try {
      const views = await api.refreshViews(id);
      set({ views, staleNodeIds: new Set() });
      void get().refreshSettings();
      get().showToast('过期部分已刷新 ✓');
    } catch (err) {
      get().showToast((err as Error).message, 'error');
    } finally {
      set({ generatingViews: false });
    }
  },

  showToast(text, kind = 'info') {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { text, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), 4500);
  },

  async refreshSettings() {
    set({ settings: await api.settings() });
  },

  updateChangeSet(cs) {
    const list = get().changesets;
    const idx = list.findIndex(c => c.id === cs.id);
    const next = idx === -1 ? [cs, ...list] : list.map(c => (c.id === cs.id ? cs : c));
    set({ changesets: next });
  },
}));
