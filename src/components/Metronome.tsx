import { useState, useEffect, useRef } from 'react';
import './Metronome.css';

interface MetronomeProps {
  onBeatChange?: (currentBeat: number) => void;
}

export default function Metronome({ onBeatChange }: MetronomeProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(90);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // 伴奏相关状态
  const [backingTrack, setBackingTrack] = useState<string | null>(null);
  const [backingTrackName, setBackingTrackName] = useState<string>('');
  const [playWithBeat, setPlayWithBeat] = useState(true);
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

  // 处理节拍器逻辑
  useEffect(() => {
    if (isPlaying) {
      const beatInterval = 60000 / bpm; // 转换为毫秒

      intervalRef.current = window.setInterval(() => {
        setCurrentBeat((prev) => {
          const nextBeat = (prev + 1) % 4; // 4/4拍
          const isStrongBeat = nextBeat === 0;
          playBeat(isStrongBeat);

          if (onBeatChange) {
            onBeatChange(nextBeat);
          }

          return nextBeat;
        });
      }, beatInterval);

      // 播放伴奏
      if (backingAudioRef.current && playWithBeat && backingTrack) {
        backingAudioRef.current.play().catch(err => console.error('播放伴奏失败:', err));
      }
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setCurrentBeat(0);

      // 暂停伴奏
      if (backingAudioRef.current) {
        backingAudioRef.current.pause();
        backingAudioRef.current.currentTime = 0;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, bpm, onBeatChange, soundEnabled, backingTrack, playWithBeat]);

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
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
              <label className="play-with-beat-control">
                <input
                  type="checkbox"
                  checked={playWithBeat}
                  onChange={(e) => setPlayWithBeat(e.target.checked)}
                />
                跟随节拍器播放
              </label>

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
