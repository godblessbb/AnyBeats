import { createContext, useContext, useSyncExternalStore } from 'react';
import type { AiController } from '../engine/aiController';
import type { EditorStore } from '../engine/editorStore';
import type { Transport } from '../engine/transport';
import type { ProjectLibrary } from '../storage/library';
import type { StorageAdapter } from '../storage/StorageAdapter';

export interface Services {
  storage: StorageAdapter;
  library: ProjectLibrary;
  store: EditorStore;
  transport: Transport;
  ai: AiController;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesContext 没有提供');
  return s;
}

export function useEditor() {
  const { store } = useServices();
  return useSyncExternalStore(store.subscribe, store.getState);
}

export function useTransport() {
  const { transport } = useServices();
  return useSyncExternalStore(transport.subscribe, transport.getState);
}

export function useAi() {
  const { ai } = useServices();
  return useSyncExternalStore(ai.subscribe, ai.getState);
}

export function useLibrary() {
  const { library } = useServices();
  return useSyncExternalStore(
    (l) => library.subscribe(l),
    () => library.list(),
  );
}
