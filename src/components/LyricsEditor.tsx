import { useState, useEffect } from 'react';
import './LyricsEditor.css';
import { type LyricData } from './AILyricsGenerator';

export interface LyricBlock {
  id: string;
  text: string;
  startBeat: number; // 起始节拍位置（以1/16拍为单位）
  duration: number; // 持续时长（以1/16拍为单位）1/16拍=1, 1/8拍=2, 1/4拍=4, 1/2拍=8, 1拍=16
  measureIndex: number; // 所在小节
}

interface LyricsEditorProps {
  currentBeat: number;
  isPlaying: boolean;
  generatedLyrics?: LyricData | null;
}

export default function LyricsEditor({ currentBeat, isPlaying, generatedLyrics }: LyricsEditorProps) {
  const [lyricBlocks, setLyricBlocks] = useState<LyricBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [playbackPosition, setPlaybackPosition] = useState(0); // 当前播放位置（以1/16拍为单位）
  const [measuresCount, setMeasuresCount] = useState(4); // 可变的小节数

  const beatsPerMeasure = 64; // 每小节64个1/16拍（4拍）
  const displayBeatsPerMeasure = 16; // 显示16个格子（每格代表1/4拍）

  // 监听生成的歌词并自动导入
  useEffect(() => {
    if (generatedLyrics) {
      importLyrics(generatedLyrics);
    }
  }, [generatedLyrics]);

  // 更新播放位置（每1/4拍更新一次，即每4个1/16拍）
  useEffect(() => {
    if (isPlaying) {
      setPlaybackPosition((prev) => {
        const maxPosition = measuresCount * beatsPerMeasure;
        // 每次增加4（1个1/4拍 = 4个1/16拍）
        return (prev + 4) % maxPosition;
      });
    }
  }, [currentBeat, isPlaying, measuresCount]);

  // 导入AI生成的歌词
  const importLyrics = (data: LyricData) => {
    const newBlocks: LyricBlock[] = [];
    let idCounter = Date.now();

    data.measures.forEach((measure) => {
      measure.lyrics.forEach((lyric) => {
        newBlocks.push({
          id: (idCounter++).toString(),
          text: lyric.text,
          startBeat: measure.measureIndex * beatsPerMeasure + lyric.startBeat,
          duration: lyric.duration,
          measureIndex: measure.measureIndex,
        });
      });
    });

    // 更新小节数
    const maxMeasureIndex = Math.max(...data.measures.map(m => m.measureIndex));
    setMeasuresCount(Math.max(measuresCount, maxMeasureIndex + 1));

    setLyricBlocks(newBlocks);
  };

  // 添加新的歌词块
  const addLyricBlock = (measureIndex: number, beatPosition: number) => {
    // beatPosition 是显示格子的索引 (0-15)，每个格子 = 1/4拍 = 4个1/16拍
    const startBeat = measureIndex * beatsPerMeasure + beatPosition * 4;

    const newBlock: LyricBlock = {
      id: Date.now().toString(),
      text: '',
      startBeat,
      duration: 4, // 默认1/4拍 = 4个1/16拍
      measureIndex,
    };
    setLyricBlocks([...lyricBlocks, newBlock]);
    setEditingBlockId(newBlock.id);
    setSelectedBlockId(newBlock.id);
  };

  // 更新歌词块文本
  const updateBlockText = (id: string, text: string) => {
    setLyricBlocks(
      lyricBlocks.map((block) => (block.id === id ? { ...block, text } : block))
    );
  };

  // 更新歌词块时长
  const updateBlockDuration = (id: string, duration: number) => {
    setLyricBlocks(
      lyricBlocks.map((block) => (block.id === id ? { ...block, duration } : block))
    );
  };

  // 删除歌词块
  const deleteBlock = (id: string) => {
    setLyricBlocks(lyricBlocks.filter((block) => block.id !== id));
    if (selectedBlockId === id) setSelectedBlockId(null);
    if (editingBlockId === id) setEditingBlockId(null);
  };

  // 添加小节
  const addMeasure = () => {
    setMeasuresCount(prev => prev + 1);
  };

  // 删除最后一个小节
  const removeMeasure = () => {
    if (measuresCount <= 1) return; // 至少保留1个小节

    // 删除该小节中的所有歌词块
    setLyricBlocks(lyricBlocks.filter(block => block.measureIndex < measuresCount - 1));
    setMeasuresCount(prev => prev - 1);
  };

  // 重置播放位置
  const resetPlayback = () => {
    setPlaybackPosition(0);
  };

  // 计算文字大小
  const calculateFontSize = (block: LyricBlock): number => {
    // 基础大小根据时长（duration 以1/16拍为单位）
    let baseSize: number;
    if (block.duration >= 16) {
      baseSize = 24; // 1拍或更长
    } else if (block.duration >= 8) {
      baseSize = 22; // 1/2拍
    } else if (block.duration >= 4) {
      baseSize = 20; // 1/4拍
    } else if (block.duration >= 2) {
      baseSize = 18; // 1/8拍
    } else {
      baseSize = 16; // 1/16拍
    }

    // 根据字符数调整（每4个1/16拍建议1个字）
    const charCount = block.text.length;
    const maxChars = Math.max(1, Math.floor(block.duration / 4));

    if (charCount > maxChars) {
      // 内容过多，缩小字体
      const scale = Math.max(0.5, maxChars / charCount);
      return Math.max(12, baseSize * scale);
    }

    return baseSize;
  };

  // 渲染小节
  const renderMeasure = (measureIndex: number) => {
    const measureBlocks = lyricBlocks.filter((block) => block.measureIndex === measureIndex);
    const measureStartBeat = measureIndex * beatsPerMeasure;

    return (
      <div key={measureIndex} className="measure">
        <div className="measure-number">{measureIndex + 1}</div>
        <div className="measure-grid">
          {/* 节拍网格（显示16个格子，每格=1/4拍=4个1/16拍） */}
          {Array.from({ length: displayBeatsPerMeasure }).map((_, displayBeatIndex) => {
            // 每个显示格子代表4个1/16拍
            const beatStart = displayBeatIndex * 4;
            const absoluteBeatPosition = measureStartBeat + beatStart;
            // 检查当前播放位置是否在这个格子范围内（4个1/16拍）
            const isCurrentBeat = isPlaying &&
              playbackPosition >= absoluteBeatPosition &&
              playbackPosition < absoluteBeatPosition + 4;

            return (
              <div
                key={displayBeatIndex}
                className={`beat-cell ${displayBeatIndex % 4 === 0 ? 'strong-beat' : ''} ${isCurrentBeat ? 'playing' : ''}`}
                onClick={() => addLyricBlock(measureIndex, displayBeatIndex)}
              >
                <div className="beat-marker" />
              </div>
            );
          })}

          {/* 歌词块 */}
          {measureBlocks.map((block) => {
            const isActive = isPlaying &&
              playbackPosition >= block.startBeat &&
              playbackPosition < block.startBeat + block.duration;
            const isSelected = selectedBlockId === block.id;
            const isEditing = editingBlockId === block.id;
            const fontSize = calculateFontSize(block);
            const localBeatPosition = block.startBeat - measureIndex * beatsPerMeasure;

            return (
              <div
                key={block.id}
                className={`lyric-block ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                style={{
                  left: `${(localBeatPosition / beatsPerMeasure) * 100}%`,
                  width: `${(block.duration / beatsPerMeasure) * 100}%`,
                  fontSize: `${fontSize}px`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedBlockId(block.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingBlockId(block.id);
                }}
              >
                {isEditing ? (
                  <input
                    type="text"
                    value={block.text}
                    onChange={(e) => updateBlockText(block.id, e.target.value)}
                    onBlur={() => setEditingBlockId(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setEditingBlockId(null);
                    }}
                    autoFocus
                    className="lyric-input"
                    style={{ fontSize: `${fontSize}px` }}
                  />
                ) : (
                  <span className="lyric-text">{block.text || '点击输入'}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 选中块的控制面板
  const selectedBlock = lyricBlocks.find((b) => b.id === selectedBlockId);

  return (
    <div className="lyrics-editor">
      <div className="editor-header">
        <h2>歌词创作区</h2>
        <p className="instruction">点击任意位置添加歌词，双击编辑</p>
      </div>

      <div className="editor-controls">
        <div className="measure-controls">
          <button onClick={addMeasure} className="add-measure-button">
            ➕ 添加小节
          </button>
          <button
            onClick={removeMeasure}
            className="remove-measure-button"
            disabled={measuresCount <= 1}
          >
            ➖ 删除小节
          </button>
          <span className="measure-count">共 {measuresCount} 小节</span>
        </div>
        <button onClick={resetPlayback} className="reset-playback-button">
          ⏮ 重置播放
        </button>
      </div>

      <div className="measures-container">
        {Array.from({ length: measuresCount }).map((_, index) => renderMeasure(index))}
      </div>

      {selectedBlock && (
        <div className="block-controls">
          <h3>编辑歌词块</h3>
          <div className="control-group">
            <label>时长:</label>
            <div className="duration-buttons">
              <button
                className={selectedBlock.duration === 1 ? 'active' : ''}
                onClick={() => updateBlockDuration(selectedBlock.id, 1)}
              >
                1/16拍
              </button>
              <button
                className={selectedBlock.duration === 2 ? 'active' : ''}
                onClick={() => updateBlockDuration(selectedBlock.id, 2)}
              >
                1/8拍
              </button>
              <button
                className={selectedBlock.duration === 4 ? 'active' : ''}
                onClick={() => updateBlockDuration(selectedBlock.id, 4)}
              >
                1/4拍
              </button>
              <button
                className={selectedBlock.duration === 8 ? 'active' : ''}
                onClick={() => updateBlockDuration(selectedBlock.id, 8)}
              >
                1/2拍
              </button>
              <button
                className={selectedBlock.duration === 16 ? 'active' : ''}
                onClick={() => updateBlockDuration(selectedBlock.id, 16)}
              >
                1拍
              </button>
            </div>
          </div>
          <div className="control-group">
            <button className="delete-button" onClick={() => deleteBlock(selectedBlock.id)}>
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
