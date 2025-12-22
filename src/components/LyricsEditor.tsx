import { useState, useEffect } from 'react';
import './LyricsEditor.css';
import { type LyricData } from './AILyricsGenerator';

// 每个格子的数据（1/4拍）
export interface CellData {
  text: string;  // 格子中的文字（空格表示空拍）
  isEditing: boolean;  // 是否正在编辑
  isAccented: boolean;  // 是否标记为重音
}

interface LyricsEditorProps {
  currentBeat: number;  // 累计节拍计数
  isPlaying: boolean;
  generatedLyrics?: LyricData | null;
}

// 默认 Rap 歌词示例
const DEFAULT_LYRICS: string[][] = [
  // 小节1
  ['yo', '我来', '说唱', '嗨'],
  // 小节2
  ['节奏', '跟着', '走起来', ' '],
  // 小节3
  ['每一', '拍都', '有力', '量'],
  // 小节4
  ['音乐', '就是', '我信', '仰'],
  // 小节5
  ['跟着', '鼓点', '摇摆', 'yeah'],
  // 小节6
  ['释放', '所有的', '能量', ' '],
  // 小节7
  ['让', '节拍', '带你', '飞'],
  // 小节8
  ['这就是', 'AnyBeats', '的', 'vibe'],
];

export default function LyricsEditor({ currentBeat, isPlaying, generatedLyrics }: LyricsEditorProps) {
  // 二维数组：measures[measureIndex][cellIndex]
  // 每个 measure 有 4 个 cells，每个 cell 代表 1/4 拍
  const [measures, setMeasures] = useState<CellData[][]>([]);
  const [measuresCount, setMeasuresCount] = useState(8);

  const cellsPerMeasure = 4; // 每小节 4 个格子（每格 = 1 拍）
  const measuresPerRow = 2;  // 每行 2 个小节

  // 初始化小节数据（包含默认歌词）
  useEffect(() => {
    const initialMeasures: CellData[][] = Array.from({ length: measuresCount }, (_, measureIndex) =>
      Array.from({ length: cellsPerMeasure }, (_, cellIndex) => ({
        text: DEFAULT_LYRICS[measureIndex]?.[cellIndex] || '',
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

  // 计算当前播放位置
  const getTotalBeats = () => measuresCount * cellsPerMeasure;

  // 当前高亮的位置（循环播放）
  const getCurrentPosition = () => {
    if (!isPlaying || currentBeat === 0) return { measureIndex: -1, cellIndex: -1 };

    const totalBeats = getTotalBeats();
    // currentBeat 从 1 开始，减 1 得到从 0 开始的索引
    const beatIndex = (currentBeat - 1) % totalBeats;
    const measureIndex = Math.floor(beatIndex / cellsPerMeasure);
    const cellIndex = beatIndex % cellsPerMeasure;

    return { measureIndex, cellIndex };
  };

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

  // 添加小节（每次添加2个，保持偶数）
  const addMeasure = () => {
    setMeasures((prev) => [
      ...prev,
      Array.from({ length: cellsPerMeasure }, () => ({
        text: '',
        isEditing: false,
        isAccented: false,
      })),
      Array.from({ length: cellsPerMeasure }, () => ({
        text: '',
        isEditing: false,
        isAccented: false,
      })),
    ]);
    setMeasuresCount((prev) => prev + 2);
  };

  // 删除最后两个小节
  const removeMeasure = () => {
    if (measuresCount <= 2) return;
    setMeasures((prev) => prev.slice(0, -2));
    setMeasuresCount((prev) => prev - 2);
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

  // 计算下划线数量（根据字数表示音符时值）
  // 1字 = 1/4拍（四分音符）→ 0条下划线
  // 2字 = 1/8拍（八分音符）→ 1条下划线
  // 3-4字 = 1/16拍（十六分音符）→ 2条下划线
  // 5-8字 = 1/32拍（三十二分音符）→ 3条下划线
  const calculateUnderlines = (text: string): number => {
    // 空格或空字符串表示空拍
    if (!text || text.trim() === '') return 0;

    const charCount = text.length;
    if (charCount === 1) return 0;
    if (charCount === 2) return 1;
    if (charCount <= 4) return 2;
    if (charCount <= 8) return 3;
    return 4; // 超过8个字
  };

  // 根据字数计算字号
  const calculateFontSize = (text: string): number => {
    const charCount = text.length;

    if (charCount === 0) return 20;
    if (charCount === 1) return 28;   // 1字 -> 最大字号
    if (charCount === 2) return 24;   // 2字 -> 大字号
    if (charCount <= 4) return 20;    // 3-4字 -> 中等字号
    if (charCount <= 6) return 16;    // 5-6字 -> 小字号
    if (charCount <= 8) return 14;    // 7-8字 -> 更小字号
    return 12; // 超过8个字
  };

  // 渲染下划线
  const renderUnderlines = (count: number) => {
    if (count === 0) return null;
    return (
      <div className="underlines">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="underline" />
        ))}
      </div>
    );
  };

  // 检查是否为空拍（空格或纯空白）
  const isRestBeat = (text: string): boolean => {
    return text.trim() === '' && text.includes(' ');
  };

  // 渲染小节
  const renderMeasure = (measureIndex: number) => {
    const measureData = measures[measureIndex] || Array.from({ length: cellsPerMeasure }, () => ({
      text: '',
      isEditing: false,
      isAccented: false,
    }));

    const { measureIndex: currentMeasureIdx, cellIndex: currentCellIdx } = getCurrentPosition();

    return (
      <div key={measureIndex} className="measure">
        <div className="measure-number">{measureIndex + 1}</div>
        <div className="measure-grid">
          {measureData.map((cell, cellIndex) => {
            const isCurrentBeat = isPlaying && currentMeasureIdx === measureIndex && currentCellIdx === cellIndex;
            const fontSize = calculateFontSize(cell.text);
            const underlineCount = calculateUnderlines(cell.text);
            const isStrongBeat = cellIndex === 0; // 第一拍是强拍
            const isRest = isRestBeat(cell.text);

            return (
              <div
                key={cellIndex}
                className={`beat-cell ${isStrongBeat ? 'strong-beat' : ''} ${isCurrentBeat ? 'playing' : ''} ${cell.text && !isRest ? 'has-text' : ''} ${cell.isAccented ? 'accented' : ''} ${isRest ? 'rest-beat' : ''}`}
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
                    placeholder="空格=空拍"
                    style={{ fontSize: `${fontSize}px` }}
                  />
                ) : (
                  <div className="cell-content">
                    <div
                      className={`cell-text ${isCurrentBeat ? 'active' : ''}`}
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {isRest ? '∅' : cell.text}
                    </div>
                    {renderUnderlines(underlineCount)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 将小节按行分组（每行2个小节）
  const renderMeasureRows = () => {
    const rows = [];
    for (let i = 0; i < measuresCount; i += measuresPerRow) {
      rows.push(
        <div key={i} className="measure-row">
          {renderMeasure(i)}
          {i + 1 < measuresCount && renderMeasure(i + 1)}
        </div>
      );
    }
    return rows;
  };

  return (
    <div className="lyrics-editor">
      <div className="editor-header">
        <h3>歌词创作区</h3>
        <div className="editor-controls">
          <button onClick={addMeasure} className="control-btn add-btn">
            + 添加小节
          </button>
          <button onClick={removeMeasure} className="control-btn remove-btn" disabled={measuresCount <= 2}>
            - 删除小节
          </button>
          <button onClick={clearAllLyrics} className="control-btn clear-btn">
            清空歌词
          </button>
        </div>
      </div>

      <div className="lyrics-grid">
        {renderMeasureRows()}
      </div>

      <div className="editor-tips">
        <p><strong>使用说明：</strong></p>
        <ul>
          <li>每行2个小节，每小节4拍（4/4拍）</li>
          <li>单击格子输入歌词，按空格键表示空拍</li>
          <li>双击格子标记/取消重音（灰色背景）</li>
          <li><strong>下划线规则：</strong>1字=1/4拍无线，2字=1/8拍1线，3-4字=1/16拍2线，5-8字=1/32拍3线</li>
          <li>播放时当前拍会高亮显示，循环播放到最后再从头开始</li>
        </ul>
      </div>
    </div>
  );
}
