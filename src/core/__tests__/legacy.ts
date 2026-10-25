/**
 * 旧逻辑的逐字复刻，只给回归测试用：证明 5 个老问题在旧写法下确实会出现。
 * 每段都注明出处（文件 + 提交）。
 */

/** 问题 1（71565d9）：Metronome 传出小节内第几拍 0–3，LyricsEditor 当成 1/4 拍计数 */
export function legacyHighlight71565d9(beatInMeasure: number, measuresCount: number) {
  const cellsPerMeasure = 4;
  const currentBeat = beatInMeasure;
  const beatPosition = Math.floor(currentBeat / 4) % cellsPerMeasure;
  const measurePosition = Math.floor(currentBeat / (cellsPerMeasure * 4)) % measuresCount;
  return { measureIndex: measurePosition, cellIndex: beatPosition };
}

/** 71565d9 Metronome：setInterval 里 nextBeat = (prev + 1) % 4 并 onBeatChange(nextBeat) */
export function legacyMetronomeBeats71565d9(ticks: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < ticks; i++) {
    prev = (prev + 1) % 4;
    out.push(prev);
  }
  return out;
}

/**
 * 问题 1 后半（最新分支 43c3370 仍在）：App.handleBeatChange 只会 setIsPlaying(true)，
 * Metronome 停止时既不通知也不把累计拍数清零 → App 的 isPlaying/currentBeat 停在最后一拍。
 */
export function legacyAppPlayback43c3370() {
  let isPlaying = false;
  let currentBeat = 0;
  return {
    onBeatChange(beat: number) {
      currentBeat = beat;
      isPlaying = true;
    },
    // Metronome 停止分支里只清了自己的 beatCountRef / setCurrentBeat，没有回调 App
    onMetronomeStop() {},
    get state() {
      return { isPlaying, currentBeat };
    },
  };
}

/** 43c3370 LyricsEditor.getCurrentPosition（累计拍数 → 第几格，每格 1 拍） */
export function legacyGetCurrentPosition43c3370(currentBeat: number, isPlaying: boolean, measuresCount: number) {
  const cellsPerMeasure = 4;
  if (!isPlaying || currentBeat === 0) return { measureIndex: -1, cellIndex: -1 };
  const beatIndex = (currentBeat - 1) % (measuresCount * cellsPerMeasure);
  return { measureIndex: Math.floor(beatIndex / cellsPerMeasure), cellIndex: beatIndex % cellsPerMeasure };
}

/**
 * 问题 2（71565d9 与 43c3370 相同）：格子的 onClick / onDoubleClick。
 * 浏览器双击序列 click → click → dblclick；React 在两次事件之间重新渲染，dblclick 看到的 cell.isEditing 已是 true。
 */
export function legacyCellGesture43c3370() {
  const cell = { text: '我', isEditing: false, isAccented: false };
  return {
    cell,
    click() {
      if (!cell.isEditing) cell.isEditing = true;
    },
    dblclick() {
      if (cell.text && !cell.isEditing) cell.isAccented = !cell.isAccented;
    },
  };
}

/** 问题 3（71565d9 与 43c3370 相同）：LyricsEditor.importLyrics，startBeat/16 取整拍塞进格子 */
export function legacyImportLyrics43c3370(data: { measures: { measureIndex: number; lyrics: { text: string; startBeat: number }[] }[] }) {
  const cellsPerMeasure = 4;
  const maxMeasureIndex = Math.max(...data.measures.map((m) => m.measureIndex));
  const cells: string[][] = Array.from({ length: maxMeasureIndex + 1 }, () => Array(cellsPerMeasure).fill(''));
  data.measures.forEach((measure) => {
    measure.lyrics.forEach((lyric) => {
      const cellIndex = Math.floor(lyric.startBeat / 16);
      if (cellIndex >= 0 && cellIndex < cellsPerMeasure) cells[measure.measureIndex][cellIndex] += lyric.text;
    });
  });
  return cells;
}

/**
 * 问题 4（43c3370）：LyricsEditor 自动保存只在「已有项目名 && 有改动」时每 60s 写一次，
 * 没起名的作品从不落盘；起了名也可能丢最近 60s。
 */
export function legacyAutosave43c3370(store: Map<string, string>) {
  let currentProjectName = '';
  let isDirty = false;
  let measures: { text: string; isAccented: boolean }[][] = [];
  let elapsedSinceTimer = 0;
  return {
    edit(next: typeof measures) {
      measures = next;
      isDirty = true;
      elapsedSinceTimer = 0; // useEffect 依赖 measures，每次改动都重建 60s 的 setInterval
    },
    name(n: string) {
      currentProjectName = n;
    },
    advance(ms: number) {
      if (!currentProjectName || !isDirty) return;
      elapsedSinceTimer += ms;
      if (elapsedSinceTimer >= 60000) {
        store.set('anybeats_projects', JSON.stringify([{ name: currentProjectName, createdAt: 0, updatedAt: 0, measures }]));
        isDirty = false;
      }
    },
  };
}

/** 问题 5（71565d9 与 43c3370 相同）：Metronome.detectBPM，振幅 > 0.3 的点算平均间隔 */
export function legacyDetectBPM43c3370(data: Float32Array, sampleRate: number): number {
  const peaks: number[] = [];
  const threshold = 0.3;
  const minInterval = Math.floor(sampleRate * 0.3);
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > threshold) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] > minInterval) peaks.push(i);
    }
  }
  if (peaks.length < 2) return 90;
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) intervals.push(peaks[i] - peaks[i - 1]);
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpm = Math.round((60 * sampleRate) / avgInterval);
  return Math.max(60, Math.min(180, bpm));
}
