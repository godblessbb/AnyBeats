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

  const intervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

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
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setCurrentBeat(0);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, bpm, onBeatChange, soundEnabled]);

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
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
    </div>
  );
}
