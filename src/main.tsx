import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ServicesContext, type Services } from './components/services';
import { EditorStore } from './engine/editorStore';
import { Transport } from './engine/transport';
import { ProjectLibrary } from './storage/library';
import { createStorage } from './storage/StorageAdapter';
import './index.css';

async function boot() {
  const storage = createStorage();
  const library = new ProjectLibrary(storage);
  const store = new EditorStore({ storage, library });
  const transport = new Transport(store);
  const services: Services = { storage, library, store, transport, ai: null, recorder: null };

  // 录音整块默认不挂载（构建开关 VITE_ANYBEATS_RECORDING=1 才打开；src/audio 的代码保留）。
  // 这里直接写 import.meta.env：构建时被替换成常量，关着的时候整段连同录音代码一起被裁掉。
  if (import.meta.env.VITE_ANYBEATS_RECORDING === '1') {
    const [{ MicInputSource }, { RecordController }, { createTakeStore }] = await Promise.all([
      import('./audio/MicInputSource'),
      import('./audio/RecordController'),
      import('./storage/takeStore'),
    ]);
    services.recorder = new RecordController({ transport, editor: store, input: new MicInputSource(), store: await createTakeStore(storage), settings: storage });
  }
  // AI 入口静态版不挂载（构建开关 VITE_ANYBEATS_AI=1 才打开）
  if (import.meta.env.VITE_ANYBEATS_AI === '1') {
    const [{ AlphieBridgeProvider }, { AiController }] = await Promise.all([import('./ai'), import('./engine/aiController')]);
    services.ai = new AiController(new AlphieBridgeProvider(), store);
  }

  // 关页面 / 切走时把没落盘的改动（含撤销历史）立即写进去
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flush();
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ServicesContext.Provider value={services}>
        <App />
      </ServicesContext.Provider>
    </StrictMode>,
  );
}

void boot();
