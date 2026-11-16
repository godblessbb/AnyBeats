import { createContext, useContext, useSyncExternalStore } from 'react';
import type { RecordController } from '../audio/RecordController';
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
  /** 静态版不挂载 AI：null（见 src/features.ts） */
  ai: AiController | null;
  /** 录音默认不挂载：null（见 src/features.ts） */
  recorder: RecordController | null;
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

const noSubscribe = () => () => {};
const noState = () => null;

export function useAi() {
  const { ai } = useServices();
  return useSyncExternalStore(ai ? ai.subscribe : noSubscribe, ai ? ai.getState : noState);
}

export function useLibrary() {
  const { library } = useServices();
  return useSyncExternalStore(
    (l) => library.subscribe(l),
    () => library.list(),
  );
}

/** 录音状态；录音没挂载时为 null */
export function useRecorderMaybe() {
  const { recorder } = useServices();
  return useSyncExternalStore(recorder ? recorder.subscribe : noSubscribe, recorder ? recorder.getState : noState);
}

/** 只在录音挂载时用（RecordPanel） */
export function useRecorder() {
  const r = useRecorderMaybe();
  if (!r) throw new Error('录音没有挂载');
  return r;
}
