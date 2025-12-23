import { useState } from 'react';
import './AILyricsGenerator.css';
import {
  defaultOpenAIConfig,
  getSystemPrompt,
  getStoredApiKey,
  saveApiKey
} from '../config/openai.config';

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

// 韵脚助手生成的词汇
export interface RhymeWord {
  word: string;
  partOfSpeech: string; // 词性：名词、动词、形容词、副词等
}

interface AILyricsGeneratorProps {
  onGenerate: (data: LyricData) => void;
  currentBpm: number;
}

// 常用韵母列表
const RHYME_OPTIONS = [
  { value: 'a', label: 'a (啊、大、他)' },
  { value: 'ai', label: 'ai (爱、开、来)' },
  { value: 'an', label: 'an (安、看、man)' },
  { value: 'ang', label: 'ang (放、想、狂)' },
  { value: 'ao', label: 'ao (好、跑、道)' },
  { value: 'e', label: 'e (了、得、车)' },
  { value: 'ei', label: 'ei (给、美、飞)' },
  { value: 'en', label: 'en (人、门、很)' },
  { value: 'eng', label: 'eng (风、梦、等)' },
  { value: 'i', label: 'i (你、地、意)' },
  { value: 'ia', label: 'ia (家、下、夏)' },
  { value: 'ian', label: 'ian (天、边、钱)' },
  { value: 'iang', label: 'iang (想、亮、样)' },
  { value: 'iao', label: 'iao (要、跳、笑)' },
  { value: 'ie', label: 'ie (夜、街、写)' },
  { value: 'in', label: 'in (心、新、金)' },
  { value: 'ing', label: 'ing (行、情、听)' },
  { value: 'iong', label: 'iong (用、穷、熊)' },
  { value: 'iu', label: 'iu (流、求、走)' },
  { value: 'o', label: 'o (我、火、多)' },
  { value: 'ong', label: 'ong (中、同、红)' },
  { value: 'ou', label: 'ou (走、手、头)' },
  { value: 'u', label: 'u (不、路、哭)' },
  { value: 'ua', label: 'ua (话、花、挂)' },
  { value: 'uai', label: 'uai (快、怀、外)' },
  { value: 'uan', label: 'uan (完、看、转)' },
  { value: 'uang', label: 'uang (王、光、装)' },
  { value: 'ue', label: 'ue/üe (说、学、月)' },
  { value: 'ui', label: 'ui (对、水、最)' },
  { value: 'un', label: 'un (问、春、困)' },
  { value: 'uo', label: 'uo (说、过、火)' },
  { value: 'v', label: 'ü (女、绿、雨)' },
];

// 词性分类
const PART_OF_SPEECH_TABS = [
  { value: 'all', label: '全部' },
  { value: '名词', label: '名词' },
  { value: '动词', label: '动词' },
  { value: '形容词', label: '形容词' },
  { value: '副词', label: '副词' },
  { value: '其他', label: '其他' },
];

export default function AILyricsGenerator({ onGenerate, currentBpm }: AILyricsGeneratorProps) {
  // 主 Tab 状态
  const [activeMainTab, setActiveMainTab] = useState<'lyrics' | 'rhyme'>('lyrics');

  // AI直出歌词状态
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState(getStoredApiKey());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // 韵脚助手状态
  const [selectedRhyme, setSelectedRhyme] = useState('');
  const [wordLength, setWordLength] = useState<number>(2);
  const [rhymeTheme, setRhymeTheme] = useState('');
  const [rhymeWords, setRhymeWords] = useState<RhymeWord[]>([]);
  const [excludedWords, setExcludedWords] = useState<string[]>([]);
  const [isGeneratingRhymes, setIsGeneratingRhymes] = useState(false);
  const [rhymeError, setRhymeError] = useState<string | null>(null);
  const [activePoSTab, setActivePoSTab] = useState('all');

  // AI直出歌词功能
  const generateLyrics = async () => {
    if (!prompt.trim()) {
      setError('请输入歌词主题或风格');
      return;
    }

    if (!apiKey.trim()) {
      setError('请先设置 OpenAI API Key');
      setShowApiKeyInput(true);
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const systemPrompt = getSystemPrompt(currentBpm);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: defaultOpenAIConfig.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature: defaultOpenAIConfig.temperature,
          max_tokens: defaultOpenAIConfig.maxTokens,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || '生成失败');
      }

      const data = await response.json();
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
      setError(err.message || '生成失败，请检查API Key或网络连接');
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

  // 韵脚助手：生成押韵词汇
  const generateRhymeWords = async () => {
    if (!selectedRhyme) {
      setRhymeError('请选择韵母');
      return;
    }

    if (!apiKey.trim()) {
      setRhymeError('请先设置 OpenAI API Key');
      setShowApiKeyInput(true);
      return;
    }

    setIsGeneratingRhymes(true);
    setRhymeError(null);

    try {
      const excludeList = excludedWords.length > 0
        ? `\n\n注意：请不要包含以下已生成过的词汇：${excludedWords.join('、')}`
        : '';

      const themeHint = rhymeTheme.trim()
        ? `，主题/场景偏向：${rhymeTheme}`
        : '';

      const systemPrompt = `你是一个专业的中文押韵词汇助手。请生成押韵词汇列表。

要求：
1. 生成恰好100个押${selectedRhyme}韵的${wordLength}字中文词汇${themeHint}
2. 词汇应该是常用词，适合用于说唱/歌词创作
3. 为每个词标注词性（名词、动词、形容词、副词、其他）
4. 返回JSON格式：{"words": [{"word": "词汇", "partOfSpeech": "词性"}, ...]}
5. 确保所有词都押${selectedRhyme}韵，且字数严格为${wordLength}字
${excludeList}

只返回JSON，不要其他解释。`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: defaultOpenAIConfig.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `请生成100个押${selectedRhyme}韵的${wordLength}字词汇` }
          ],
          temperature: 0.9,
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || '生成失败');
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('无法解析生成的词汇数据');
      }

      const result = JSON.parse(jsonMatch[0]);
      const newWords: RhymeWord[] = result.words || [];

      setRhymeWords(newWords);
      // 将新生成的词添加到排除列表
      setExcludedWords(prev => [...prev, ...newWords.map(w => w.word)]);
    } catch (err: any) {
      setRhymeError(err.message || '生成失败，请检查API Key或网络连接');
      console.error('生成押韵词汇失败:', err);
    } finally {
      setIsGeneratingRhymes(false);
    }
  };

  // 换一批
  const refreshRhymeWords = () => {
    generateRhymeWords();
  };

  // 清空历史并重新生成
  const clearAndGenerate = () => {
    setExcludedWords([]);
    setRhymeWords([]);
    generateRhymeWords();
  };

  // 按词性筛选词汇
  const getFilteredWords = () => {
    if (activePoSTab === 'all') return rhymeWords;
    return rhymeWords.filter(w => w.partOfSpeech === activePoSTab);
  };

  // 拖拽开始
  const handleDragStart = (e: React.DragEvent, word: string) => {
    e.dataTransfer.setData('text/plain', word);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="ai-lyrics-generator">
      <div className="generator-header">
        <h3>AI 创作助手</h3>
        <button onClick={() => setIsCollapsed(!isCollapsed)} className="collapse-button">
          {isCollapsed ? '展开 ▼' : '收起 ▲'}
        </button>
      </div>

      {!isCollapsed && (
        <div className="generator-content">
          {/* 主 Tab 切换 */}
          <div className="main-tabs">
            <button
              className={`main-tab ${activeMainTab === 'lyrics' ? 'active' : ''}`}
              onClick={() => setActiveMainTab('lyrics')}
            >
              AI直出歌词
            </button>
            <button
              className={`main-tab ${activeMainTab === 'rhyme' ? 'active' : ''}`}
              onClick={() => setActiveMainTab('rhyme')}
            >
              韵脚助手
            </button>
          </div>

          {/* API Key 设置 */}
          {showApiKeyInput && (
            <div className="api-key-section">
              <label>OpenAI API Key:</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="api-key-input"
              />
              <button onClick={() => {
                saveApiKey(apiKey);
                setShowApiKeyInput(false);
              }} className="close-api-input">
                完成
              </button>
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

                {!showApiKeyInput && (
                  <button onClick={() => setShowApiKeyInput(true)} className="api-key-button">
                    设置 API Key
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 韵脚助手 Tab */}
          {activeMainTab === 'rhyme' && (
            <div className="rhyme-tab-content">
              <div className="rhyme-controls">
                <div className="control-row">
                  <div className="control-item">
                    <label>韵母 <span className="required">*</span></label>
                    <select
                      value={selectedRhyme}
                      onChange={(e) => setSelectedRhyme(e.target.value)}
                      className="rhyme-select"
                    >
                      <option value="">请选择韵母</option>
                      {RHYME_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="control-item">
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
                </div>

                <div className="control-row">
                  <div className="control-item full-width">
                    <label>主题（可选）</label>
                    <input
                      type="text"
                      value={rhymeTheme}
                      onChange={(e) => setRhymeTheme(e.target.value)}
                      placeholder="如：恋爱、炫富、街头、励志..."
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
                    {isGeneratingRhymes ? '生成中...' : '生成押韵词汇'}
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

                  {!showApiKeyInput && (
                    <button onClick={() => setShowApiKeyInput(true)} className="api-key-button small">
                      设置 API Key
                    </button>
                  )}
                </div>
              </div>

              {rhymeError && <div className="error-message">{rhymeError}</div>}

              {/* 词性分类 Tab */}
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

                  {/* 词汇卡片网格 */}
                  <div className="word-cards-grid">
                    {getFilteredWords().map((item, index) => (
                      <div
                        key={`${item.word}-${index}`}
                        className="word-card"
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.word)}
                      >
                        <span className="word-text">{item.word}</span>
                        <span className="word-pos">{item.partOfSpeech}</span>
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
                    <li>选择韵母和字数后，点击"生成押韵词汇"</li>
                    <li>可输入主题让词汇更贴合你的创作场景</li>
                    <li>生成的词汇可以<strong>直接拖拽</strong>到下方节拍格子中</li>
                    <li>点击"换一批"会生成新词汇（不重复之前的）</li>
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
