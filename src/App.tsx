import { useState } from 'react';
import Metronome from './components/Metronome';
import LyricsEditor, { type CellData } from './components/LyricsEditor';
import AILyricsGenerator, { type LyricData } from './components/AILyricsGenerator';
import './App.css';

function App() {
  const [currentBeat, setCurrentBeat] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(90);
  const [generatedLyrics, setGeneratedLyrics] = useState<LyricData | null>(null);
  const [measures, setMeasures] = useState<CellData[][]>([]);
  const [selectedCell, setSelectedCell] = useState<{ measureIndex: number; cellIndex: number } | null>(null);

  const handleBeatChange = (beat: number) => {
    setCurrentBeat(beat);
    setIsPlaying(true);
  };

  const handleGenerateLyrics = (data: LyricData) => {
    setGeneratedLyrics(data);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎤 AnyBeats - Rap 创作工具</h1>
        <p className="tagline">节奏与韵律的完美融合</p>
      </header>

      <div className="app-container">
        <div className="metronome-section">
          <Metronome
            onBeatChange={handleBeatChange}
            onBpmChange={setBpm}
            measures={measures}
            selectedCell={selectedCell}
          />
        </div>

        <div className="editor-section">
          <AILyricsGenerator
            onGenerate={handleGenerateLyrics}
            currentBpm={bpm}
          />

          <LyricsEditor
            currentBeat={currentBeat}
            isPlaying={isPlaying}
            generatedLyrics={generatedLyrics}
            onMeasuresChange={setMeasures}
            onSelectedCellChange={setSelectedCell}
          />
        </div>
      </div>

      <footer className="app-footer">
        <p>使用说明：在AI歌词生成区输入需求生成歌词，或点击"使用示例"查看效果。歌词会自动填入下方创作区。</p>
      </footer>
    </div>
  );
}

export default App;
