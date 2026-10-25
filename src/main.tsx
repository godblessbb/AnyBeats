import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AlphieBridgeProvider, type AiProvider } from './ai';
import App from './App.tsx';
import { ServicesContext, type Services } from './components/services';
import { AiController } from './engine/aiController';
import { EditorStore } from './engine/editorStore';
import { Transport } from './engine/transport';
import { ProjectLibrary } from './storage/library';
import { createStorage } from './storage/StorageAdapter';
import './index.css';

async function pickProvider(): Promise<AiProvider> {
  // 只在开发服务器里（npm run dev）能用 ?ai=fake 看 AI 预览样子；生产构建里这段整个被裁掉
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('ai') === 'fake') {
    const { FakeProvider } = await import('./ai/FakeProvider');
    return new FakeProvider({ worker: '本机 Claude CLI', delayMs: 300 });
  }
  return new AlphieBridgeProvider();
}

async function boot() {
  const storage = createStorage();
  const library = new ProjectLibrary(storage);
  const store = new EditorStore({ storage, library });
  const transport = new Transport(store);
  const ai = new AiController(await pickProvider(), store);
  void ai.check();

  // 关页面 / 切走时把没落盘的改动立即写进去（core/autosave 的 flush）
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flush();
  });

  const services: Services = { storage, library, store, transport, ai };
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ServicesContext.Provider value={services}>
        <App />
      </ServicesContext.Provider>
    </StrictMode>,
  );
}

void boot();
