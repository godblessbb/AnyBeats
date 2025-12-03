import { useState, useEffect } from 'react';
import './LyricsEditor.css';

export interface LyricBlock {
  id: string;
  text: string;
  startBeat: number; // 起始节拍位置（以1/4拍为单位）
  duration: number; // 持续时长（以1/4拍为单位）1拍=4, 1/2拍=2, 1/4拍=1
  measureIndex: number; // 所在小节
}

interface LyricsEditorProps {
  currentBeat: number;
  isPlaying: boolean;
}

export default function LyricsEditor({ currentBeat, isPlaying }: LyricsEditorProps) {
  const [lyricBlocks, setLyricBlocks] = useState<LyricBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [playbackPosition, setPlaybackPosition] = useState(0); // 当前播放位置（1/4拍为单位）
  const [measuresCount, setMeasuresCount] = useState(4); // 可变的小节数

  const beatsPerMeasure = 16; // 每小节16个1/4拍（4拍）

  // 更新播放位置（每1/4拍更新一次）
  useEffect(() => {
    if (isPlaying) {
      setPlaybackPosition((prev) => {
        const maxPosition = measuresCount * beatsPerMeasure;
        return (prev + 1) % maxPosition;
      });
    }
  }, [currentBeat, isPlaying, measuresCount]);

  // 添加新的歌词块
  const addLyricBlock = (measureIndex: number, beatPosition: number) => {
    const newBlock: LyricBlock = {
      id: Date.now().toString(),
      text: '',
      startBeat: measureIndex * beatsPerMeasure + beatPosition,
      duration: 4, // 默认1拍
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
    // 基础大小根据时长
    let baseSize: number;
    if (block.duration >= 4) {
      baseSize = 24; // 1拍或更长
    } else if (block.duration >= 2) {
      baseSize = 20; // 1/2拍
    } else {
      baseSize = 16; // 1/4拍
    }

    // 根据字符数调整
    const charCount = block.text.length;
    const maxChars = block.duration; // 每个1/4拍建议1个字

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
          {/* 节拍网格 */}
          {Array.from({ length: beatsPerMeasure }).map((_, beatIndex) => {
            const absoluteBeatPosition = measureStartBeat + beatIndex;
            const isCurrentBeat = isPlaying && playbackPosition === absoluteBeatPosition;

            return (
              <div
                key={beatIndex}
                className={`beat-cell ${beatIndex % 4 === 0 ? 'strong-beat' : ''} ${isCurrentBeat ? 'playing' : ''}`}
                onClick={() => addLyricBlock(measureIndex, beatIndex)}
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
                1/4拍
              </button>
              <button
                className={selectedBlock.duration === 2 ? 'active' : ''}
                onClick={() => updateBlockDuration(selectedBlock.id, 2)}
              >
                1/2拍
              </button>
              <button
                className={selectedBlock.duration === 4 ? 'active' : ''}
                onClick={() => updateBlockDuration(selectedBlock.id, 4)}
              >
                1拍
              </button>
              <button
                className={selectedBlock.duration === 8 ? 'active' : ''}
                onClick={() => updateBlockDuration(selectedBlock.id, 8)}
              >
                2拍
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
