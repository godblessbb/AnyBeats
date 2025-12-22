import { useState, useEffect } from 'react';
import './LyricsEditor.css';
import { type LyricData } from './AILyricsGenerator';

// 每个格子的数据（1/4拍）
export interface CellData {
  text: string;  // 格子中的文字
  isEditing: boolean;  // 是否正在编辑
  isAccented: boolean;  // 是否标记为重音
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

  const cellsPerMeasure = 4; // 每小节 4 个格子（每格 = 1 拍）

  // 初始化小节数据
  useEffect(() => {
    const initialMeasures: CellData[][] = Array.from({ length: measuresCount }, () =>
      Array.from({ length: cellsPerMeasure }, () => ({
        text: '',
        isEditing: false,
        isAccented: false,
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

  // 更新播放位置（每 1 拍更新一次）
  useEffect(() => {
    if (isPlaying) {
      // currentBeat 是 1/4 拍，所以每4次更新才移动到下一个格子
      const beatPosition = Math.floor(currentBeat / 4) % cellsPerMeasure;
      const measurePosition = Math.floor(currentBeat / (cellsPerMeasure * 4)) % measuresCount;

      setPlaybackPosition(beatPosition);
      setCurrentMeasure(measurePosition);
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
        isAccented: false,
      }))
    );

    // 填充歌词数据
    data.measures.forEach((measure) => {
      measure.lyrics.forEach((lyric) => {
        // startBeat 以 1/16 拍为单位，转换为 1 拍单位（除以 16）
        const cellIndex = Math.floor(lyric.startBeat / 16);

        if (cellIndex >= 0 && cellIndex < cellsPerMeasure) {
          // 如果该格子已有文字，拼接到一起
          if (newMeasures[measure.measureIndex][cellIndex].text) {
            newMeasures[measure.measureIndex][cellIndex].text += lyric.text;
          } else {
            newMeasures[measure.measureIndex][cellIndex].text = lyric.text;
          }
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
          isAccented: false,
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

  // 切换重音标记
  const toggleAccent = (measureIndex: number, cellIndex: number) => {
    setMeasures((prev) => {
      const newMeasures = [...prev];
      if (newMeasures[measureIndex] && newMeasures[measureIndex][cellIndex]) {
        newMeasures[measureIndex] = [...newMeasures[measureIndex]];
        newMeasures[measureIndex][cellIndex] = {
          ...newMeasures[measureIndex][cellIndex],
          isAccented: !newMeasures[measureIndex][cellIndex].isAccented,
        };
      }
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
        isAccented: false,
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
          isAccented: false,
        }))
      )
    );
  };

  // 根据字数计算字号
  const calculateFontSize = (text: string): number => {
    const charCount = text.length;

    if (charCount === 0) return 20;
    if (charCount === 1) return 32;   // 1字 -> 最大字号
    if (charCount === 2) return 28;   // 2字 -> 大字号
    if (charCount <= 4) return 24;    // 3-4字 -> 中等字号
    if (charCount <= 6) return 20;    // 5-6字 -> 小字号
    if (charCount <= 8) return 18;    // 7-8字 -> 更小字号
    if (charCount <= 10) return 16;   // 9-10字

    // 超过10个字，继续缩小
    return Math.max(12, 16 - (charCount - 10) * 0.3);
  };

  // 渲染小节
  const renderMeasure = (measureIndex: number) => {
    const measureData = measures[measureIndex] || Array.from({ length: cellsPerMeasure }, () => ({
      text: '',
      isEditing: false,
      isAccented: false,
    }));

    return (
      <div key={measureIndex} className="measure">
        <div className="measure-number">{measureIndex + 1}</div>
        <div className="measure-grid">
          {measureData.map((cell, cellIndex) => {
            const isCurrentBeat = isPlaying && currentMeasure === measureIndex && playbackPosition === cellIndex;
            const fontSize = calculateFontSize(cell.text);
            const isStrongBeat = cellIndex === 0; // 第一拍是强拍

            return (
              <div
                key={cellIndex}
                className={`beat-cell ${isStrongBeat ? 'strong-beat' : ''} ${isCurrentBeat ? 'playing' : ''} ${cell.text ? 'has-text' : ''} ${cell.isAccented ? 'accented' : ''}`}
                onClick={() => {
                  if (!cell.isEditing) {
                    setCellEditing(measureIndex, cellIndex, true);
                  }
                }}
                onDoubleClick={() => {
                  if (cell.text && !cell.isEditing) {
                    toggleAccent(measureIndex, cellIndex);
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
        {/* 每行显示1个小节 */}
        {Array.from({ length: measuresCount }).map((_, measureIndex) => (
          renderMeasure(measureIndex)
        ))}
      </div>

      <div className="editor-tips">
        <p><strong>使用说明：</strong></p>
        <ul>
          <li>每个小节有4个歌词块，每块代表1拍</li>
          <li>单击格子输入歌词</li>
          <li>双击格子标记/取消重音（灰色背景）</li>
          <li>字号自动调整：字数越多，字号越小</li>
          <li>输入完成后按 Enter 或点击其他地方完成编辑</li>
          <li>播放时当前格子会高亮显示（绿色）</li>
        </ul>
      </div>
    </div>
  );
}
