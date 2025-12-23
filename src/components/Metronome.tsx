import { useState, useEffect, useRef } from 'react';
import './Metronome.css';

// 从 LyricsEditor 导入 CellData 类型
interface CellData {
  text: string;
  isEditing: boolean;
  isAccented: boolean;
}

interface MetronomeProps {
  onBeatChange?: (currentBeat: number) => void;
  onBpmChange?: (bpm: number) => void;
  measures?: CellData[][];  // 歌词数据，用于智能导唱
  selectedCell?: { measureIndex: number; cellIndex: number } | null;  // 选中的格子，用于从选中位置开始
}

export default function Metronome({ onBeatChange, onBpmChange, measures = [], selectedCell = null }: MetronomeProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(90);
  const [smartGuide, setSmartGuide] = useState(false);  // 智能导唱模式

  // 通知父组件 BPM 变化
  useEffect(() => {
    if (onBpmChange) {
      onBpmChange(bpm);
    }
  }, [bpm, onBpmChange]);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // 伴奏相关状态
  const [backingTrack, setBackingTrack] = useState<string | null>(null);
  const [backingTrackName, setBackingTrackName] = useState<string>('');
  const [isBackingPlaying, setIsBackingPlaying] = useState(false); // 伴奏独立播放状态
  const [backingVolume, setBackingVolume] = useState(0.7);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const intervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const backingAudioRef = useRef<HTMLAudioElement | null>(null);

  // 初始化音频上下文
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // 播放节拍音效
  const playBeat = (isStrongBeat: boolean) => {
    if (!soundEnabled || !audioContextRef.current) return;

    const audioContext = audioContextRef.current;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // 强拍用高音，弱拍用低音
    oscillator.frequency.value = isStrongBeat ? 1000 : 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  };

  // BPM 检测算法
  const detectBPM = async (audioBuffer: AudioBuffer): Promise<number> => {
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;

    // 分析音频峰值
    const peaks: number[] = [];
    const threshold = 0.3;
    const minInterval = Math.floor(sampleRate * 0.3); // 最小间隔约0.3秒 (200 BPM)

    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > threshold) {
        if (peaks.length === 0 || i - peaks[peaks.length - 1] > minInterval) {
          peaks.push(i);
        }
      }
    }

    // 计算峰值间隔
    if (peaks.length < 2) return 90; // 默认值

    const intervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i] - peaks[i - 1]);
    }

    // 计算平均间隔
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = Math.round((60 * sampleRate) / avgInterval);

    // 限制在合理范围内
    return Math.max(60, Math.min(180, bpm));
  };

  // 处理文件上传
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    setBackingTrackName(file.name);

    // 创建音频 URL
    const url = URL.createObjectURL(file);
    setBackingTrack(url);

    // 分析 BPM
    try {
      if (audioContextRef.current) {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
        const detectedBPM = await detectBPM(audioBuffer);
        setBpm(detectedBPM);
      }
    } catch (error) {
      console.error('BPM 检测失败:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 更新伴奏音量
  useEffect(() => {
    if (backingAudioRef.current) {
      backingAudioRef.current.volume = backingVolume;
    }
  }, [backingVolume]);

  // 累计节拍计数（用于歌词高亮）
  const beatCountRef = useRef(0);
  // 保存回调函数的引用，避免 useEffect 依赖变化
  const onBeatChangeRef = useRef(onBeatChange);
  onBeatChangeRef.current = onBeatChange;
  // 保存 measures 引用
  const measuresRef = useRef(measures);
  measuresRef.current = measures;
  // 保存 smartGuide 引用
  const smartGuideRef = useRef(smartGuide);
  smartGuideRef.current = smartGuide;
  // 保存 selectedCell 引用
  const selectedCellRef = useRef(selectedCell);
  selectedCellRef.current = selectedCell;
  // 用于存储智能导唱的定时器
  const subdivisionTimersRef = useRef<number[]>([]);

  // 清理所有细分定时器
  const clearSubdivisionTimers = () => {
    subdivisionTimersRef.current.forEach(timer => clearTimeout(timer));
    subdivisionTimersRef.current = [];
  };

  // 播放智能导唱节拍（根据字数细分）
  const playSmartGuideBeat = (beatIndex: number, beatInterval: number) => {
    const cellsPerMeasure = 4;
    const currentMeasures = measuresRef.current;
    const totalCells = currentMeasures.length * cellsPerMeasure;

    // 如果没有歌词数据，播放普通节拍
    if (totalCells === 0) {
      playBeat(true);
      return;
    }

    // 使用模运算实现循环
    const wrappedIndex = (beatIndex - 1) % totalCells;
    const measureIndex = Math.floor(wrappedIndex / cellsPerMeasure);
    const cellIndex = wrappedIndex % cellsPerMeasure;

    if (!currentMeasures[measureIndex] || !currentMeasures[measureIndex][cellIndex]) {
      // 没有歌词数据，播放普通节拍
      playBeat(cellIndex === 0);
      return;
    }

    const cellText = currentMeasures[measureIndex][cellIndex].text;

    if (!cellText || cellText.trim() === '') {
      // 空格子，播放普通节拍
      playBeat(cellIndex === 0);
      return;
    }

    // 有文字，按字数细分
    const chars = cellText.split('');
    const charInterval = beatInterval / chars.length;

    chars.forEach((char, index) => {
      if (char !== ' ') {
        // 非空拍，播放音效
        const timer = window.setTimeout(() => {
          // 第一个字用高音（强调），其他用低音
          playBeat(index === 0 && cellIndex === 0);
        }, index * charInterval);
        subdivisionTimersRef.current.push(timer);
      }
      // 空拍（空格）不播放，只等待时间
    });
  };

  // 处理节拍器逻辑
  useEffect(() => {
    if (isPlaying) {
      const beatInterval = 60000 / bpm; // 转换为毫秒
      const cellsPerMeasure = 4;

      // 如果有选中的格子且开启了智能导唱，从选中位置开始
      if (selectedCellRef.current && smartGuideRef.current) {
        const { measureIndex, cellIndex } = selectedCellRef.current;
        const startBeat = measureIndex * cellsPerMeasure + cellIndex;
        beatCountRef.current = startBeat;  // 设置起始位置，interval 会从这里开始
        setCurrentBeat(cellIndex);
      }

      intervalRef.current = window.setInterval(() => {
        // 先更新累计节拍计数
        beatCountRef.current += 1;
        const currentBeatCount = beatCountRef.current;

        setCurrentBeat((prev) => {
          const nextBeat = (prev + 1) % 4; // 4/4拍显示

          // 智能导唱模式
          if (smartGuideRef.current) {
            playSmartGuideBeat(currentBeatCount, beatInterval);
          } else {
            // 普通模式
            const isStrongBeat = nextBeat === 0;
            playBeat(isStrongBeat);
          }

          return nextBeat;
        });

        // 在 setState 外面调用回调，确保同步
        if (onBeatChangeRef.current) {
          onBeatChangeRef.current(currentBeatCount);
        }
      }, beatInterval);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      clearSubdivisionTimers();
      setCurrentBeat(0);
      beatCountRef.current = 0; // 重置累计计数
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      clearSubdivisionTimers();
    };
  }, [isPlaying, bpm, soundEnabled]); // 移除 onBeatChange 依赖，使用 ref 代替

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  // 伴奏播放控制
  const toggleBackingPlay = () => {
    if (!backingAudioRef.current) return;

    if (isBackingPlaying) {
      backingAudioRef.current.pause();
    } else {
      backingAudioRef.current.play().catch(err => console.error('播放伴奏失败:', err));
    }
    setIsBackingPlaying(!isBackingPlaying);
  };

  // 重置伴奏
  const resetBacking = () => {
    if (backingAudioRef.current) {
      backingAudioRef.current.pause();
      backingAudioRef.current.currentTime = 0;
      setIsBackingPlaying(false);
    }
  };

  const removeBackingTrack = () => {
    if (backingAudioRef.current) {
      backingAudioRef.current.pause();
      backingAudioRef.current.src = '';
    }
    if (backingTrack) {
      URL.revokeObjectURL(backingTrack);
    }
    setBackingTrack(null);
    setBackingTrackName('');
  };

  return (
    <div className="metronome">
      <h2>节拍器</h2>

      <div className="beat-indicator">
        {[0, 1, 2, 3].map((beat) => (
          <div
            key={beat}
            className={`beat-dot ${currentBeat === beat && isPlaying ? 'active' : ''} ${
              beat === 0 ? 'strong' : ''
            }`}
          />
        ))}
      </div>

      <button className={`play-button ${isPlaying ? 'playing' : ''}`} onClick={togglePlay}>
        {isPlaying ? '⏸' : '▶'}
      </button>

      <div className="bpm-control">
        <label>BPM: {bpm}</label>
        <input
          type="range"
          min="60"
          max="180"
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          className="bpm-slider"
        />
      </div>

      <div className="sound-control">
        <label>
          <input
            type="checkbox"
            checked={soundEnabled}
            onChange={(e) => setSoundEnabled(e.target.checked)}
          />
          节拍音效
        </label>
        <label>
          <input
            type="checkbox"
            checked={smartGuide}
            onChange={(e) => setSmartGuide(e.target.checked)}
          />
          智能导唱
        </label>
      </div>

      {/* 伴奏上传区 */}
      <div className="backing-track-section">
        <h3>伴奏</h3>

        {!backingTrack ? (
          <div className="upload-area">
            <input
              type="file"
              id="backing-file"
              accept="audio/*"
              onChange={handleFileUpload}
              className="file-input"
            />
            <label htmlFor="backing-file" className="upload-button">
              📁 上传伴奏
            </label>
            {isAnalyzing && <p className="analyzing-text">正在分析 BPM...</p>}
          </div>
        ) : (
          <div className="backing-info">
            <div className="track-name">
              <span className="music-icon">🎵</span>
              <span className="file-name">{backingTrackName}</span>
              <button onClick={removeBackingTrack} className="remove-button">
                ✕
              </button>
            </div>

            <div className="backing-controls">
              <div className="backing-buttons">
                <button
                  onClick={toggleBackingPlay}
                  className={`backing-play-button ${isBackingPlaying ? 'playing' : ''}`}
                >
                  {isBackingPlaying ? '⏸ 暂停' : '▶ 播放'}
                </button>
                <button onClick={resetBacking} className="backing-reset-button">
                  ⏮ 重置
                </button>
              </div>

              <div className="volume-control">
                <label>音量: {Math.round(backingVolume * 100)}%</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={backingVolume}
                  onChange={(e) => setBackingVolume(Number(e.target.value))}
                  className="volume-slider"
                />
              </div>
            </div>
          </div>
        )}

        {/* 隐藏的音频元素 */}
        {backingTrack && (
          <audio
            ref={backingAudioRef}
            src={backingTrack}
            loop
            style={{ display: 'none' }}
          />
        )}
      </div>
    </div>
  );
}
