import { useState, useEffect } from 'react';
import './LyricsEditor.css';
import { type LyricData } from './AILyricsGenerator';

// 每个格子的数据（1/4拍）
export interface CellData {
  text: string;  // 格子中的文字
  isEditing: boolean;  // 是否正在编辑
}

interface LyricsEditorProps {
  currentBeat: number;
  isPlaying: boolean;
  generatedLyrics?: LyricData | null;
}

export default function LyricsEditor({ currentBeat, isPlaying, generatedLyrics }: LyricsEditorProps) {
  // 二维数组：measures[measureIndex][cellIndex]
  // 每个 measure 有 16 个 cells，每个 cell 代表 1/4 拍
  const [measures, setMeasures] = useState<CellData[][]>([]);
  const [measuresCount, setMeasuresCount] = useState(4);
  const [playbackPosition, setPlaybackPosition] = useState(0); // 以 1/4 拍为单位 (0-15 per measure)
  const [currentMeasure, setCurrentMeasure] = useState(0);

  const cellsPerMeasure = 16; // 每小节 16 个格子（每格 = 1/4 拍）

  // 初始化小节数据
  useEffect(() => {
    const initialMeasures: CellData[][] = Array.from({ length: measuresCount }, () =>
      Array.from({ length: cellsPerMeasure }, () => ({
        text: '',
        isEditing: false,
      }))
    );
    setMeasures(initialMeasures);
  }, []);

  // 监听生成的歌词并自动导入
  useEffect(() => {
    if (generatedLyrics) {
      importLyrics(generatedLyrics);
    }
  }, [generatedLyrics]);

  // 更新播放位置（每 1/4 拍更新一次）
  useEffect(() => {
    if (isPlaying) {
      setPlaybackPosition((prev) => {
        const next = (prev + 1) % cellsPerMeasure;
        if (next === 0) {
          // 进入下一小节
          setCurrentMeasure((m) => (m + 1) % measuresCount);
        }
        return next;
      });
    }
  }, [currentBeat, isPlaying, measuresCount]);

  // 导入 AI 生成的歌词
  const importLyrics = (data: LyricData) => {
    // 确保有足够的小节
    const maxMeasureIndex = Math.max(...data.measures.map(m => m.measureIndex));
    const requiredMeasures = maxMeasureIndex + 1;

    if (requiredMeasures > measuresCount) {
      setMeasuresCount(requiredMeasures);
    }

    // 创建新的 measures 数组
    const newMeasures: CellData[][] = Array.from({ length: Math.max(measuresCount, requiredMeasures) }, () =>
      Array.from({ length: cellsPerMeasure }, () => ({
        text: '',
        isEditing: false,
      }))
    );

    // 填充歌词数据
    data.measures.forEach((measure) => {
      measure.lyrics.forEach((lyric) => {
        // startBeat 以 1/16 拍为单位，转换为 1/4 拍单位（除以 4）
        const cellIndex = Math.floor(lyric.startBeat / 4);

        if (cellIndex >= 0 && cellIndex < cellsPerMeasure) {
          newMeasures[measure.measureIndex][cellIndex].text = lyric.text;
        }
      });
    });

    setMeasures(newMeasures);
  };

  // 更新格子的文字
  const updateCellText = (measureIndex: number, cellIndex: number, text: string) => {
    setMeasures((prev) => {
      const newMeasures = [...prev];
      if (!newMeasures[measureIndex]) {
        newMeasures[measureIndex] = Array.from({ length: cellsPerMeasure }, () => ({
          text: '',
          isEditing: false,
        }));
      }
      newMeasures[measureIndex] = [...newMeasures[measureIndex]];
      newMeasures[measureIndex][cellIndex] = {
        ...newMeasures[measureIndex][cellIndex],
        text,
      };
      return newMeasures;
    });
  };

  // 设置编辑状态
  const setCellEditing = (measureIndex: number, cellIndex: number, isEditing: boolean) => {
    setMeasures((prev) => {
      const newMeasures = prev.map((measure, mIdx) =>
        measure.map((cell, cIdx) => ({
          ...cell,
          isEditing: mIdx === measureIndex && cIdx === cellIndex ? isEditing : false,
        }))
      );
      return newMeasures;
    });
  };

  // 添加小节
  const addMeasure = () => {
    setMeasures((prev) => [
      ...prev,
      Array.from({ length: cellsPerMeasure }, () => ({
        text: '',
        isEditing: false,
      })),
    ]);
    setMeasuresCount((prev) => prev + 1);
  };

  // 删除最后一个小节
  const removeMeasure = () => {
    if (measuresCount <= 1) return;
    setMeasures((prev) => prev.slice(0, -1));
    setMeasuresCount((prev) => prev - 1);
  };

  // 重置播放位置
  const resetPlayback = () => {
    setPlaybackPosition(0);
    setCurrentMeasure(0);
  };

  // 清空所有歌词
  const clearAllLyrics = () => {
    setMeasures((prev) =>
      prev.map((measure) =>
        measure.map(() => ({
          text: '',
          isEditing: false,
        }))
      )
    );
  };

  // 根据字数计算字号
  const calculateFontSize = (text: string): number => {
    const charCount = text.length;

    if (charCount === 0) return 20;
    if (charCount === 1) return 28;  // 1字 = 1/4拍 -> 大字号
    if (charCount === 2) return 24;  // 2字 = 1/8拍 -> 中等字号
    if (charCount <= 4) return 20;   // 3-4字 = 1/16拍 -> 小字号
    if (charCount <= 8) return 16;   // 5-8字 = 1/32拍 -> 最小字号

    // 超过8个字，继续缩小
    return Math.max(12, 16 - (charCount - 8));
  };

  // 渲染小节
  const renderMeasure = (measureIndex: number) => {
    const measureData = measures[measureIndex] || Array.from({ length: cellsPerMeasure }, () => ({
      text: '',
      isEditing: false,
    }));

    return (
      <div key={measureIndex} className="measure">
        <div className="measure-number">{measureIndex + 1}</div>
        <div className="measure-grid">
          {measureData.map((cell, cellIndex) => {
            const isCurrentBeat = isPlaying && currentMeasure === measureIndex && playbackPosition === cellIndex;
            const fontSize = calculateFontSize(cell.text);
            const isStrongBeat = cellIndex % 4 === 0;

            return (
              <div
                key={cellIndex}
                className={`beat-cell ${isStrongBeat ? 'strong-beat' : ''} ${isCurrentBeat ? 'playing' : ''} ${cell.text ? 'has-text' : ''}`}
                onClick={() => {
                  if (!cell.isEditing) {
                    setCellEditing(measureIndex, cellIndex, true);
                  }
                }}
              >
                <div className="beat-marker" />
                {cell.isEditing ? (
                  <input
                    type="text"
                    className="cell-input"
                    value={cell.text}
                    onChange={(e) => updateCellText(measureIndex, cellIndex, e.target.value)}
                    onBlur={() => setCellEditing(measureIndex, cellIndex, false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        setCellEditing(measureIndex, cellIndex, false);
                      }
                    }}
                    autoFocus
                    style={{ fontSize: `${fontSize}px` }}
                  />
                ) : (
                  <div
                    className={`cell-text ${isCurrentBeat ? 'active' : ''}`}
                    style={{ fontSize: `${fontSize}px` }}
                  >
                    {cell.text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="lyrics-editor">
      <div className="editor-header">
        <h3>歌词创作区</h3>
        <div className="editor-controls">
          <button onClick={addMeasure} className="control-btn add-btn">
            ➕ 添加小节
          </button>
          <button onClick={removeMeasure} className="control-btn remove-btn" disabled={measuresCount <= 1}>
            ➖ 删除小节
          </button>
          <button onClick={resetPlayback} className="control-btn reset-btn">
            🔄 重置播放
          </button>
          <button onClick={clearAllLyrics} className="control-btn clear-btn">
            🗑️ 清空歌词
          </button>
        </div>
      </div>

      <div className="lyrics-grid">
        {Array.from({ length: measuresCount }).map((_, index) => renderMeasure(index))}
      </div>

      <div className="editor-tips">
        <p><strong>使用说明：</strong></p>
        <ul>
          <li>点击任意格子输入歌词（每格 = 1/4 拍）</li>
          <li>1个字 = 大字号（1/4拍），2个字 = 中等（1/8拍），3-4个字 = 小字号（1/16拍），5-8个字 = 最小（1/32拍）</li>
          <li>输入完成后按 Enter 或点击其他地方完成编辑</li>
          <li>播放时当前格子会高亮显示</li>
        </ul>
      </div>
    </div>
  );
}
