/**
 * 录音输入的唯一入口。录音、延迟校准只认这个接口，不关心声音从哪来。
 *
 * - MicInputSource：本页自己开麦克风（getUserMedia + AudioWorklet），独立打开（npm run dev）时用。
 * - ChunkInputSource：由外部把 PCM 分片推进来。Alphie 画布是 sandbox iframe，浏览器不给开麦克风，
 *   以后由外层页面录音、再把分片传给画布；传输协议还在设计，这里只留接收端。
 *
 * 时间基准：PcmChunk.time 是这一片第一个采样对应的 AudioContext 时间（秒）。
 * 录音对齐、延迟校准都按这个时间算，所以两种输入可以互换。
 */

export type InputAvailability = { ok: true } | { ok: false; reason: string };

export interface PcmChunk {
  /** 单声道，采样率 = 录音用的 AudioContext.sampleRate */
  samples: Float32Array;
  /** 第一个采样的 AudioContext 时间（秒） */
  time: number;
}

/** 输入源需要的那一点 AudioContext：采样率和当前时间；麦克风另外要建节点 */
export type InputContext = Pick<AudioContext, 'sampleRate' | 'currentTime'> & Partial<Pick<AudioContext, 'audioWorklet' | 'createMediaStreamSource'>>;

export interface InputStarted {
  /** 设备名（拿不到时为空串），用来判断是不是蓝牙耳机 */
  label: string;
}

export interface AudioInputSource {
  readonly kind: 'mic' | 'chunk';
  /** 现在能不能录；不能时 reason 直接显示在录音按钮上 */
  availability(): InputAvailability;
  /** 可用性变化（例如外层页面接上了）时通知 */
  subscribe(listener: () => void): () => void;
  /** 开始往 onChunk 推分片；不能录时抛 InputError（message 就是给人看的原因），不会一直挂着 */
  start(ctx: InputContext, onChunk: (chunk: PcmChunk) => void): Promise<InputStarted>;
  stop(): void;
}

export class InputError extends Error {}
