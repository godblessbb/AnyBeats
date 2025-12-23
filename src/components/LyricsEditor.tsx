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

// 保存的作品数据结构
interface SavedProject {
  name: string;
  createdAt: number;
  updatedAt: number;
  measures: { text: string; isAccented: boolean }[][];
}

const STORAGE_KEY = 'anybeats_projects';

export default function LyricsEditor({ currentBeat, isPlaying, generatedLyrics }: LyricsEditorProps) {
  // 二维数组：measures[measureIndex][cellIndex]
  // 每个 measure 有 4 个 cells，每个 cell 代表 1/4 拍
  const [measures, setMeasures] = useState<CellData[][]>([]);
  const [measuresCount, setMeasuresCount] = useState(16); // 默认 16 个空小节
  const [dragOverCell, setDragOverCell] = useState<{ measureIndex: number; cellIndex: number } | null>(null);
  const [dragSource, setDragSource] = useState<{ measureIndex: number; cellIndex: number } | null>(null);
  const [isDraggingFromCell, setIsDraggingFromCell] = useState(false);

  // 保存/加载相关状态
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [currentProjectName, setCurrentProjectName] = useState<string>('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // 小节拖拽状态
  const [dragMeasureIndex, setDragMeasureIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const cellsPerMeasure = 4; // 每小节 4 个格子（每格 = 1 拍）
  const measuresPerRow = 2;  // 每行 2 个小节

  // 初始化小节数据（默认为空小节）
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

  // 加载已保存的项目列表
  useEffect(() => {
    loadProjectList();
  }, []);

  // 监听生成的歌词并自动导入
  useEffect(() => {
    if (generatedLyrics) {
      importLyrics(generatedLyrics);
    }
  }, [generatedLyrics]);

  // 加载项目列表
  const loadProjectList = () => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const projects: SavedProject[] = JSON.parse(data);
        setSavedProjects(projects.sort((a, b) => b.updatedAt - a.updatedAt));
      }
    } catch (e) {
      console.error('加载项目列表失败:', e);
    }
  };

  // 保存当前项目
  const saveProject = (name: string) => {
    if (!name.trim()) return;

    const projectData: SavedProject = {
      name: name.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      measures: measures.map(m => m.map(c => ({ text: c.text, isAccented: c.isAccented }))),
    };

    try {
      const data = localStorage.getItem(STORAGE_KEY);
      let projects: SavedProject[] = data ? JSON.parse(data) : [];

      // 检查是否已存在同名项目
      const existingIndex = projects.findIndex(p => p.name === name.trim());
      if (existingIndex >= 0) {
        projectData.createdAt = projects[existingIndex].createdAt;
        projects[existingIndex] = projectData;
      } else {
        projects.push(projectData);
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      setSavedProjects(projects.sort((a, b) => b.updatedAt - a.updatedAt));
      setCurrentProjectName(name.trim());
      setShowSaveDialog(false);
      setNewProjectName('');
    } catch (e) {
      console.error('保存项目失败:', e);
      alert('保存失败，请重试');
    }
  };

  // 加载项目
  const loadProject = (project: SavedProject) => {
    const loadedMeasures: CellData[][] = project.measures.map(m =>
      m.map(c => ({
        text: c.text,
        isAccented: c.isAccented,
        isEditing: false,
      }))
    );

    setMeasures(loadedMeasures);
    setMeasuresCount(loadedMeasures.length);
    setCurrentProjectName(project.name);
    setShowLoadDialog(false);
  };

  // 删除项目
  const deleteProject = (name: string) => {
    if (!confirm(`确定要删除作品 "${name}" 吗？`)) return;

    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        let projects: SavedProject[] = JSON.parse(data);
        projects = projects.filter(p => p.name !== name);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
        setSavedProjects(projects.sort((a, b) => b.updatedAt - a.updatedAt));
        if (currentProjectName === name) {
          setCurrentProjectName('');
        }
      }
    } catch (e) {
      console.error('删除项目失败:', e);
    }
  };

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

  // 拖拽事件处理
  const handleDragOver = (e: React.DragEvent, measureIndex: number, cellIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    // 根据来源设置不同的 dropEffect
    e.dataTransfer.dropEffect = isDraggingFromCell ? 'move' : 'copy';
    setDragOverCell({ measureIndex, cellIndex });
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverCell(null);
  };

  const handleDrop = (e: React.DragEvent, measureIndex: number, cellIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const word = e.dataTransfer.getData('text/plain');
    if (word) {
      // 如果是从歌词区拖拽的，清空源格子
      if (dragSource && isDraggingFromCell) {
        // 避免拖到原位置
        if (dragSource.measureIndex === measureIndex && dragSource.cellIndex === cellIndex) {
          setDragOverCell(null);
          setDragSource(null);
          setIsDraggingFromCell(false);
          return;
        }
        // 清空源格子
        updateCellText(dragSource.measureIndex, dragSource.cellIndex, '');
      }
      updateCellText(measureIndex, cellIndex, word);
    }
    setDragOverCell(null);
    setDragSource(null);
    setIsDraggingFromCell(false);
  };

  // 格子内的词开始拖拽
  const handleCellDragStart = (e: React.DragEvent, measureIndex: number, cellIndex: number, text: string) => {
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.effectAllowed = 'move';
    setDragSource({ measureIndex, cellIndex });
    setIsDraggingFromCell(true);
  };

  const handleCellDragEnd = () => {
    setDragSource(null);
    setIsDraggingFromCell(false);
  };

  // 小节拖拽处理
  const handleMeasureDragStart = (e: React.DragEvent, measureIndex: number) => {
    e.dataTransfer.setData('measure-index', measureIndex.toString());
    e.dataTransfer.effectAllowed = 'move';
    setDragMeasureIndex(measureIndex);
  };

  const handleMeasureDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragMeasureIndex !== null && dragMeasureIndex !== targetIndex) {
      setDropTargetIndex(targetIndex);
    }
  };

  const handleMeasureDragLeave = () => {
    setDropTargetIndex(null);
  };

  const handleMeasureDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (dragMeasureIndex !== null && dragMeasureIndex !== targetIndex) {
      // 重新排序小节
      setMeasures(prev => {
        const newMeasures = [...prev];
        const [movedMeasure] = newMeasures.splice(dragMeasureIndex, 1);
        newMeasures.splice(targetIndex, 0, movedMeasure);
        return newMeasures;
      });
    }

    setDragMeasureIndex(null);
    setDropTargetIndex(null);
  };

  const handleMeasureDragEnd = () => {
    setDragMeasureIndex(null);
    setDropTargetIndex(null);
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

  // 检查是否包含空拍（空格）
  const hasRestBeat = (text: string): boolean => {
    return text.includes(' ');
  };

  // 检查是否全是空拍
  const isFullRestBeat = (text: string): boolean => {
    return text.trim() === '' && text.length > 0;
  };

  // 将文本中的空格替换为∅符号显示
  const formatDisplayText = (text: string): string => {
    if (!text) return '';
    // 将空格替换为∅符号
    return text.replace(/ /g, '∅');
  };

  // 渲染小节
  const renderMeasure = (measureIndex: number) => {
    const measureData = measures[measureIndex] || Array.from({ length: cellsPerMeasure }, () => ({
      text: '',
      isEditing: false,
      isAccented: false,
    }));

    const { measureIndex: currentMeasureIdx, cellIndex: currentCellIdx } = getCurrentPosition();

    const isMeasureDragging = dragMeasureIndex === measureIndex;
    const isMeasureDropTarget = dropTargetIndex === measureIndex;

    return (
      <div
        key={measureIndex}
        className={`measure ${isMeasureDragging ? 'measure-dragging' : ''} ${isMeasureDropTarget ? 'measure-drop-target' : ''}`}
        onDragOver={(e) => handleMeasureDragOver(e, measureIndex)}
        onDragLeave={handleMeasureDragLeave}
        onDrop={(e) => handleMeasureDrop(e, measureIndex)}
      >
        <div
          className="measure-number"
          draggable
          onDragStart={(e) => handleMeasureDragStart(e, measureIndex)}
          onDragEnd={handleMeasureDragEnd}
          title="拖拽可重新排列小节"
        >
          {measureIndex + 1}
        </div>
        <div className="measure-grid">
          {measureData.map((cell, cellIndex) => {
            const isCurrentBeat = isPlaying && currentMeasureIdx === measureIndex && currentCellIdx === cellIndex;
            const fontSize = calculateFontSize(cell.text);
            const underlineCount = calculateUnderlines(cell.text);
            const isStrongBeat = cellIndex === 0; // 第一拍是强拍
            const isFullRest = isFullRestBeat(cell.text);
            const displayText = formatDisplayText(cell.text);

            const isDragOver = dragOverCell?.measureIndex === measureIndex && dragOverCell?.cellIndex === cellIndex;
            const isDragSourceCell = dragSource?.measureIndex === measureIndex && dragSource?.cellIndex === cellIndex;
            const hasDraggableContent = cell.text && !isFullRest && !cell.isEditing;

            return (
              <div
                key={cellIndex}
                className={`beat-cell ${isStrongBeat ? 'strong-beat' : ''} ${isCurrentBeat ? 'playing' : ''} ${cell.text && !isFullRest ? 'has-text' : ''} ${cell.isAccented ? 'accented' : ''} ${isFullRest ? 'rest-beat' : ''} ${hasRestBeat(cell.text) && !isFullRest ? 'has-rest' : ''} ${isDragOver ? 'drag-over' : ''} ${isDragSourceCell ? 'drag-source' : ''}`}
                draggable={hasDraggableContent ? true : false}
                onClick={() => {
                  if (!cell.isEditing && !isDraggingFromCell) {
                    setCellEditing(measureIndex, cellIndex, true);
                  }
                }}
                onDoubleClick={() => {
                  if (cell.text && !cell.isEditing) {
                    toggleAccent(measureIndex, cellIndex);
                  }
                }}
                onDragStart={(e) => {
                  if (hasDraggableContent) {
                    handleCellDragStart(e, measureIndex, cellIndex, cell.text);
                  }
                }}
                onDragEnd={handleCellDragEnd}
                onDragOver={(e) => handleDragOver(e, measureIndex, cellIndex)}
                onDragLeave={(e) => handleDragLeave(e)}
                onDrop={(e) => handleDrop(e, measureIndex, cellIndex)}
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
                      {displayText}
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

  // 格式化时间
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="lyrics-editor">
      <div className="editor-header">
        <div className="header-title">
          <h3>歌词创作区</h3>
          {currentProjectName && <span className="project-name">- {currentProjectName}</span>}
        </div>
        <div className="editor-controls">
          <button onClick={() => setShowSaveDialog(true)} className="control-btn save-btn">
            💾 保存
          </button>
          <button onClick={() => { loadProjectList(); setShowLoadDialog(true); }} className="control-btn load-btn">
            📂 加载 {savedProjects.length > 0 && `(${savedProjects.length})`}
          </button>
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

      {/* 保存对话框 */}
      {showSaveDialog && (
        <div className="dialog-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h4>保存作品</h4>
            <input
              type="text"
              value={newProjectName || currentProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              placeholder="输入作品名称"
              className="dialog-input"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  saveProject(newProjectName || currentProjectName);
                }
              }}
            />
            <div className="dialog-buttons">
              <button onClick={() => saveProject(newProjectName || currentProjectName)} className="btn-primary">
                保存
              </button>
              <button onClick={() => setShowSaveDialog(false)} className="btn-secondary">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 加载对话框 */}
      {showLoadDialog && (
        <div className="dialog-overlay" onClick={() => setShowLoadDialog(false)}>
          <div className="dialog dialog-wide" onClick={e => e.stopPropagation()}>
            <h4>加载作品</h4>
            {savedProjects.length === 0 ? (
              <p className="no-projects">暂无保存的作品</p>
            ) : (
              <div className="project-list">
                {savedProjects.map(project => (
                  <div key={project.name} className="project-item">
                    <div className="project-info" onClick={() => loadProject(project)}>
                      <span className="project-title">{project.name}</span>
                      <span className="project-date">{formatDate(project.updatedAt)}</span>
                    </div>
                    <button
                      className="project-delete"
                      onClick={(e) => { e.stopPropagation(); deleteProject(project.name); }}
                      title="删除"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="dialog-buttons">
              <button onClick={() => setShowLoadDialog(false)} className="btn-secondary">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="lyrics-grid">
        {renderMeasureRows()}
      </div>

      <div className="editor-tips">
        <p><strong>使用说明：</strong></p>
        <ul>
          <li>每行2个小节，每小节4拍（4/4拍）</li>
          <li>从上方韵脚助手<strong>拖拽词汇</strong>到格子中，自动生成对应下划线</li>
          <li><strong>格子内的词可拖拽</strong>移动到其他位置，原位置自动清空</li>
          <li><strong>拖拽小节编号</strong>可重新排列小节顺序</li>
          <li>单击格子手动输入歌词，输入空格表示空拍（显示为∅）</li>
          <li>双击格子标记/取消重音（灰色背景）</li>
          <li><strong>保存/加载：</strong>点击保存按钮可保存当前作品，加载按钮可恢复之前的作品</li>
        </ul>
      </div>
    </div>
  );
}
