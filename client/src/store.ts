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

  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  refreshAll: () => Promise<void>;
  setActiveView: (v: ActiveView) => void;
  selectNode: (id: string | null) => void;
  setDevMode: (on: boolean) => void;
  generateViews: () => Promise<void>;
  showToast: (text: string, kind?: 'info' | 'error') => void;
  refreshSettings: () => Promise<void>;
  updateChangeSet: (cs: ChangeSet) => void;
}

let unsubscribe: (() => void) | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

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

  async openProject(id: string) {
    unsubscribe?.();
    const [meta, settings] = await Promise.all([api.project(id), api.settings()]);
    set({ meta, settings, selectedNodeId: null, staleNodeIds: new Set() });
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
