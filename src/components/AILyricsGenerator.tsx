import { useState, useEffect } from 'react';
import './AILyricsGenerator.css';
import {
  defaultOpenAIConfig,
  getSystemPrompt,
  getStoredModel,
  saveModel,
  getApiEndpoint,
  getApiKey,
  AVAILABLE_MODELS,
} from '../config/openai.config';
import { RHYME_API } from '../config/api.config';

export interface LyricData {
  bpm: number;
  timeSignature: string;
  measures: MeasureData[];
}

export interface MeasureData {
  measureIndex: number;
  lyrics: LyricItem[];
}

export interface LyricItem {
  text: string;
  startBeat: number;
  duration: number;
}

export interface RhymeWord {
  word: string;
  tone: number;  // 声调 1-5
  toneCat: string;  // 平/仄/轻
  partOfSpeech: string;
}

interface AILyricsGeneratorProps {
  onGenerate: (data: LyricData) => void;
  currentBpm: number;
}

// 声调筛选选项
const TONE_OPTIONS = [
  { value: '', label: '不限' },
  { value: '平', label: '平声 (1,2声)' },
  { value: '仄', label: '仄声 (3,4声)' },
  { value: '1', label: '1声' },
  { value: '2', label: '2声' },
  { value: '3', label: '3声' },
  { value: '4', label: '4声' },
];

// 常用韵母列表
const RHYME_OPTIONS = [
  { value: 'a', label: 'a (啊、大)' },
  { value: 'ai', label: 'ai (爱、来)' },
  { value: 'an', label: 'an (安、看)' },
  { value: 'ang', label: 'ang (放、想)' },
  { value: 'ao', label: 'ao (好、道)' },
  { value: 'e', label: 'e (了、得)' },
  { value: 'ei', label: 'ei (给、飞)' },
  { value: 'en', label: 'en (人、很)' },
  { value: 'eng', label: 'eng (风、梦)' },
  { value: 'i', label: 'i (你、意)' },
  { value: 'ia', label: 'ia (家、下)' },
  { value: 'ian', label: 'ian (天、钱)' },
  { value: 'iang', label: 'iang (想、样)' },
  { value: 'iao', label: 'iao (要、笑)' },
  { value: 'ie', label: 'ie (夜、写)' },
  { value: 'in', label: 'in (心、金)' },
  { value: 'ing', label: 'ing (行、听)' },
  { value: 'iu', label: 'iu (流、走)' },
  { value: 'o', label: 'o (我、多)' },
  { value: 'ong', label: 'ong (中、红)' },
  { value: 'ou', label: 'ou (走、头)' },
  { value: 'u', label: 'u (不、路)' },
  { value: 'ua', label: 'ua (话、花)' },
  { value: 'uan', label: 'uan (完、转)' },
  { value: 'uang', label: 'uang (王、光)' },
  { value: 'ue', label: 'ue (说、月)' },
  { value: 'ui', label: 'ui (对、最)' },
  { value: 'un', label: 'un (问、春)' },
  { value: 'uo', label: 'uo (说、过)' },
];

const PART_OF_SPEECH_TABS = [
  { value: 'all', label: '全部' },
  { value: '名词', label: '名词' },
  { value: '动词', label: '动词' },
  { value: '形容词', label: '形容词' },
  { value: '副词', label: '副词' },
  { value: '其他', label: '其他' },
];

export default function AILyricsGenerator({ onGenerate, currentBpm }: AILyricsGeneratorProps) {
  // 主 Tab 状态 - 默认韵脚助手
  const [activeMainTab, setActiveMainTab] = useState<'lyrics' | 'rhyme'>('rhyme');

  // 通用状态
  const [selectedModel, setSelectedModel] = useState(getStoredModel());
  const [isCollapsed, setIsCollapsed] = useState(false);

  // 后端状态
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);

  // AI直出歌词状态
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 韵脚助手状态
  const [selectedRhyme, setSelectedRhyme] = useState('');
  const [wordLength, setWordLength] = useState<number>(2);
  const [selectedTone, setSelectedTone] = useState('');  // 声调筛选
  const [rhymeTheme, setRhymeTheme] = useState('');
  const [rhymeWords, setRhymeWords] = useState<RhymeWord[]>([]);
  const [shownWords, setShownWords] = useState<Set<string>>(new Set());  // 已显示过的词汇
  const [isGeneratingRhymes, setIsGeneratingRhymes] = useState(false);
  const [rhymeError, setRhymeError] = useState<string | null>(null);
  const [activePoSTab, setActivePoSTab] = useState('all');

  // 检查后端是否可用
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const response = await fetch(RHYME_API.health, {
          method: 'GET',
          signal: AbortSignal.timeout(3000)
        });
        const data = await response.json();
        setBackendAvailable(data.db_ready === true);
      } catch {
        setBackendAvailable(false);
      }
    };
    checkBackend();
  }, []);

  // 切换模型
  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    saveModel(model);
  };

  // 调用 AI API (用于歌词生成)
  const callAI = async (systemPrompt: string, userPrompt: string, maxTokens: number = 2000) => {
    const apiKey = getApiKey(selectedModel);

    if (!apiKey) {
      throw new Error('未配置 API Key，请在 .env 文件中设置对应的 API Key');
    }

    const endpoint = getApiEndpoint(selectedModel);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: defaultOpenAIConfig.temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API 请求失败 (${response.status})`);
    }

    return response.json();
  };

  // AI直出歌词功能
  const generateLyrics = async () => {
    if (!prompt.trim()) {
      setError('请输入歌词主题或风格');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const systemPrompt = getSystemPrompt(currentBpm);
      const data = await callAI(systemPrompt, prompt);
      const content = data.choices[0].message.content;

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('无法解析生成的歌词数据');
      }

      const lyricData: LyricData = JSON.parse(jsonMatch[0]);

      if (!lyricData.measures || lyricData.measures.length === 0) {
        throw new Error('生成的歌词数据格式不正确');
      }

      onGenerate(lyricData);
      setPrompt('');
    } catch (err: any) {
      setError(err.message || '生成失败，请检查 API Key 配置或网络连接');
      console.error('生成歌词失败:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const useExampleData = () => {
    const exampleData: LyricData = {
      bpm: currentBpm,
      timeSignature: "4/4",
      measures: [
        {
          measureIndex: 0,
          lyrics: [
            { text: "我", startBeat: 0, duration: 4 },
            { text: "走", startBeat: 4, duration: 4 },
            { text: "在", startBeat: 8, duration: 4 },
            { text: "街", startBeat: 12, duration: 4 },
            { text: "上", startBeat: 16, duration: 8 },
            { text: "感", startBeat: 24, duration: 4 },
            { text: "受", startBeat: 28, duration: 4 },
            { text: "节", startBeat: 32, duration: 4 },
            { text: "奏", startBeat: 36, duration: 12 },
          ]
        },
        {
          measureIndex: 1,
          lyrics: [
            { text: "音", startBeat: 0, duration: 4 },
            { text: "乐", startBeat: 4, duration: 4 },
            { text: "在", startBeat: 8, duration: 4 },
            { text: "耳", startBeat: 12, duration: 4 },
            { text: "边", startBeat: 16, duration: 8 },
            { text: "回", startBeat: 24, duration: 4 },
            { text: "荡", startBeat: 28, duration: 12 },
          ]
        }
      ]
    };
    onGenerate(exampleData);
  };

  // 韵脚助手：使用后端API生成押韵词汇
  const generateRhymeWords = async (excludeWords?: string[]) => {
    if (!selectedRhyme) {
      setRhymeError('请选择韵母');
      return;
    }

    setIsGeneratingRhymes(true);
    setRhymeError(null);

    try {
      // 构建请求参数
      const requestBody: any = {
        rhyme: selectedRhyme,
        word_length: wordLength,
        theme: rhymeTheme || null,
        limit: 100,
        shuffle: true,  // 随机打乱结果
      };

      // 添加排除词汇
      if (excludeWords && excludeWords.length > 0) {
        requestBody.exclude = excludeWords;
      }

      // 添加声调筛选
      if (selectedTone) {
        if (selectedTone === '平' || selectedTone === '仄') {
          requestBody.tone_cat = selectedTone;
        } else {
          requestBody.tone = parseInt(selectedTone);
        }
      }

      // 调用后端API
      const response = await fetch(RHYME_API.search, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `请求失败 (${response.status})`);
      }

      const data = await response.json();

      // 转换格式
      const newWords: RhymeWord[] = data.words.map((w: any) => ({
        word: w.word,
        tone: w.tone || 0,
        toneCat: w.tone_cat || '',
        partOfSpeech: w.part_of_speech || '其他',
      }));

      // 更新已显示词汇集合
      setShownWords(prev => {
        const updated = new Set(prev);
        newWords.forEach(w => updated.add(w.word));
        return updated;
      });

      setRhymeWords(newWords);
    } catch (err: any) {
      // 检查是否是后端未启动
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        setRhymeError('韵脚后端未启动，请先运行 backend/start.bat');
      } else {
        setRhymeError(err.message || '生成失败');
      }
      console.error('生成押韵词汇失败:', err);
    } finally {
      setIsGeneratingRhymes(false);
    }
  };

  // 换一批：排除当前已显示的词汇
  const refreshRhymeWords = () => {
    const currentWords = rhymeWords.map(w => w.word);
    const allShown = Array.from(shownWords);
    generateRhymeWords([...new Set([...currentWords, ...allShown])]);
  };

  // 清空重来：重置已显示记录
  const clearAndGenerate = () => {
    setRhymeWords([]);
    setShownWords(new Set());
    generateRhymeWords();
  };

  const getFilteredWords = () => {
    if (activePoSTab === 'all') return rhymeWords;
    return rhymeWords.filter(w => w.partOfSpeech === activePoSTab);
  };

  const handleDragStart = (e: React.DragEvent, word: string) => {
    e.dataTransfer.setData('text/plain', word);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="ai-lyrics-generator">
      <div className="generator-header">
        <h3>AI 创作助手</h3>
        <div className="header-buttons">
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            className="model-select-header"
          >
            {AVAILABLE_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="collapse-button">
            {isCollapsed ? '展开 ▼' : '收起 ▲'}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="generator-content">
          {/* 主 Tab 切换 */}
          <div className="main-tabs">
            <button
              className={`main-tab ${activeMainTab === 'rhyme' ? 'active' : ''}`}
              onClick={() => setActiveMainTab('rhyme')}
            >
              韵脚助手
              {backendAvailable === true && <span className="backend-status online">●</span>}
              {backendAvailable === false && <span className="backend-status offline">●</span>}
            </button>
            <button
              className={`main-tab ${activeMainTab === 'lyrics' ? 'active' : ''}`}
              onClick={() => setActiveMainTab('lyrics')}
            >
              AI直出歌词
            </button>
          </div>

          {/* 韵脚助手 Tab */}
          {activeMainTab === 'rhyme' && (
            <div className="rhyme-tab-content">
              {/* 后端状态提示 */}
              {backendAvailable === false && (
                <div className="backend-warning">
                  ⚠️ 韵脚后端未启动，请先运行 <code>backend/start.bat</code> 初始化词库
                </div>
              )}

              {/* 控件一行排列 */}
              <div className="rhyme-controls-row">
                <div className="control-item small">
                  <label>韵母 <span className="required">*</span></label>
                  <select
                    value={selectedRhyme}
                    onChange={(e) => setSelectedRhyme(e.target.value)}
                    className="rhyme-select"
                  >
                    <option value="">选择</option>
                    {RHYME_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div className="control-item small">
                  <label>字数 <span className="required">*</span></label>
                  <select
                    value={wordLength}
                    onChange={(e) => setWordLength(Number(e.target.value))}
                    className="length-select"
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map(n => (
                      <option key={n} value={n}>{n}字</option>
                    ))}
                  </select>
                </div>

                <div className="control-item small">
                  <label>声调</label>
                  <select
                    value={selectedTone}
                    onChange={(e) => setSelectedTone(e.target.value)}
                    className="tone-select"
                  >
                    {TONE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div className="control-item large">
                  <label>主题（可选，语义搜索）</label>
                  <input
                    type="text"
                    value={rhymeTheme}
                    onChange={(e) => setRhymeTheme(e.target.value)}
                    placeholder="如：汽车、恋爱、炫富、街头、励志..."
                    className="theme-input"
                  />
                </div>
              </div>

              <div className="rhyme-buttons">
                <button
                  onClick={generateRhymeWords}
                  disabled={isGeneratingRhymes || !selectedRhyme}
                  className="generate-button"
                >
                  {isGeneratingRhymes ? '搜索中...' : '搜索押韵词汇'}
                </button>

                {rhymeWords.length > 0 && (
                  <>
                    <button onClick={refreshRhymeWords} disabled={isGeneratingRhymes} className="refresh-button">
                      换一批
                    </button>
                    <button onClick={clearAndGenerate} disabled={isGeneratingRhymes} className="clear-button">
                      清空重来
                    </button>
                  </>
                )}
              </div>

              {rhymeError && <div className="error-message">{rhymeError}</div>}

              {rhymeWords.length > 0 && (
                <div className="pos-tabs-container">
                  <div className="pos-tabs">
                    {PART_OF_SPEECH_TABS.map(tab => (
                      <button
                        key={tab.value}
                        className={`pos-tab ${activePoSTab === tab.value ? 'active' : ''}`}
                        onClick={() => setActivePoSTab(tab.value)}
                      >
                        {tab.label}
                        {tab.value !== 'all' && (
                          <span className="count">
                            ({rhymeWords.filter(w => w.partOfSpeech === tab.value).length})
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="word-cards-grid">
                    {getFilteredWords().map((item, index) => (
                      <div
                        key={`${item.word}-${index}`}
                        className={`word-card tone-${item.toneCat}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.word)}
                        title={`${item.tone}声 (${item.toneCat})`}
                      >
                        <span className="word-text">{item.word}</span>
                        <div className="word-meta">
                          <span className="word-tone">{item.tone}声</span>
                          <span className="word-pos">{item.partOfSpeech}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {getFilteredWords().length === 0 && (
                    <div className="no-words-hint">该分类暂无词汇</div>
                  )}
                </div>
              )}

              {rhymeWords.length === 0 && !isGeneratingRhymes && (
                <div className="rhyme-tips">
                  <p><strong>使用说明：</strong></p>
                  <ul>
                    <li>选择韵母和字数后，点击"搜索押韵词汇"</li>
                    <li>输入主题可进行<strong>语义搜索</strong>，找到相关词汇</li>
                    <li>基于本地词库 + 向量数据库，100%押韵准确</li>
                    <li>生成的词汇可以<strong>直接拖拽</strong>到下方节拍格子中</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* AI直出歌词 Tab */}
          {activeMainTab === 'lyrics' && (
            <div className="lyrics-tab-content">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="请输入歌词主题、风格或具体需求，例如：&#10;- 写一段关于梦想的说唱&#10;- 快节奏的街头风格&#10;- 关于友情的慢节奏说唱"
                className="prompt-textarea"
                rows={4}
                disabled={isGenerating}
              />

              {error && <div className="error-message">{error}</div>}

              <div className="button-group">
                <button
                  onClick={generateLyrics}
                  disabled={isGenerating}
                  className="generate-button"
                >
                  {isGenerating ? '生成中...' : '生成歌词'}
                </button>

                <button onClick={useExampleData} className="example-button">
                  使用示例
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
