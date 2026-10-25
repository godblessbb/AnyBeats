/**
 * 录音用的 AudioWorklet：把输入（混成单声道）攒成 2048 帧一片，连同第一帧的 currentFrame 发回主线程。
 * 构建产物是单个 index.html，worklet 代码也得内联：用 Blob URL 加载。
 */

export const RECORDER_PROCESSOR = 'anybeats-recorder';
const BLOCK = 2048;

const SOURCE = `
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(${BLOCK});
    this.n = 0;
    this.start = 0;
    this.on = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; };
  }
  process(inputs) {
    const input = inputs[0];
    if (!this.on) return false;
    if (!input || input.length === 0) return true;
    const len = input[0].length;
    const k = 1 / input.length;
    for (let i = 0; i < len; i++) {
      if (this.n === 0) this.start = currentFrame + i;
      let v = 0;
      for (let c = 0; c < input.length; c++) v += input[c][i];
      this.buf[this.n++] = v * k;
      if (this.n === ${BLOCK}) {
        this.port.postMessage({ frame: this.start, samples: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(${BLOCK});
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('${RECORDER_PROCESSOR}', Recorder);
`;

const loaded = new WeakMap<object, Promise<void>>();

export function loadRecorderWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([SOURCE], { type: 'application/javascript' }));
    p = ctx.audioWorklet
      .addModule(url)
      .catch((e) => {
        loaded.delete(ctx);
        throw e;
      })
      .finally(() => URL.revokeObjectURL(url));
    loaded.set(ctx, p);
  }
  return p;
}
