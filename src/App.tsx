import { useState } from 'react';
import Metronome from './components/Metronome';
import LyricsEditor from './components/LyricsEditor';
import './App.css';

function App() {
  const [currentBeat, setCurrentBeat] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleBeatChange = (beat: number) => {
    setCurrentBeat(beat);
    setIsPlaying(true);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎤 AnyBeats - Rap 创作工具</h1>
        <p className="tagline">节奏与韵律的完美融合</p>
      </header>

      <div className="app-container">
        <div className="metronome-section">
          <Metronome onBeatChange={handleBeatChange} />
        </div>

        <div className="editor-section">
          <LyricsEditor
            currentBeat={currentBeat}
            isPlaying={isPlaying}
          />
        </div>
      </div>

      <footer className="app-footer">
        <p>使用说明：点击播放按钮启动节拍器，在歌词区点击添加歌词块，双击编辑内容</p>
      </footer>
    </div>
  );
}

export default App;
