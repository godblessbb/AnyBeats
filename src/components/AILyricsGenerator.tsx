import { useState } from 'react';
import './AILyricsGenerator.css';

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
  startBeat: number; // 以1/16拍为单位 (0-63 for 4/4 time)
  duration: number; // 以1/16拍为单位 (1=1/16拍, 4=1/4拍, 8=1/2拍, 16=1拍)
}

interface AILyricsGeneratorProps {
  onGenerate: (data: LyricData) => void;
  currentBpm: number;
}

export default function AILyricsGenerator({ onGenerate, currentBpm }: AILyricsGeneratorProps) {
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

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
      const systemPrompt = `你是一个专业的说唱歌词创作助手。请根据用户的需求生成说唱歌词，并严格按照以下JSON格式输出：

{
  "bpm": ${currentBpm},
  "timeSignature": "4/4",
  "measures": [
    {
      "measureIndex": 0,
      "lyrics": [
        {
          "text": "单个字或词",
          "startBeat": 0,
          "duration": 4
        }
      ]
    }
  ]
}

重要说明：
1. startBeat 和 duration 都以 1/16拍为单位
2. 每小节有64个1/16拍（4/4拍 = 4拍 = 64个1/16拍）
3. 常用时值：1/16拍=1, 1/8拍=2, 1/4拍=4, 1/2拍=8, 1拍=16
4. 请合理分配每个字的时值，快速说唱可用1/16拍或1/8拍，慢速可用1/4拍或更长
5. 生成2-4个小节的内容
6. 确保每个小节的歌词时值总和不超过64
7. 只返回JSON，不要有其他文字

请现在根据用户需求创作歌词。`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature: 0.8,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || '生成失败');
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      // 解析JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('无法解析生成的歌词数据');
      }

      const lyricData: LyricData = JSON.parse(jsonMatch[0]);

      // 验证数据
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

  // 使用示例数据（用于测试，无需API Key）
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

  return (
    <div className="ai-lyrics-generator">
      <div className="generator-header">
        <h3>AI 歌词生成</h3>
        <button onClick={() => setIsCollapsed(!isCollapsed)} className="collapse-button">
          {isCollapsed ? '展开 ▼' : '收起 ▲'}
        </button>
      </div>

      {!isCollapsed && (
        <div className="generator-content">
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
            <button onClick={() => setShowApiKeyInput(false)} className="close-api-input">
              完成
            </button>
          </div>
        )}

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
            {isGenerating ? '生成中...' : '🤖 生成歌词'}
          </button>

          <button
            onClick={useExampleData}
            className="example-button"
          >
            📝 使用示例
          </button>

          {!showApiKeyInput && (
            <button
              onClick={() => setShowApiKeyInput(true)}
              className="api-key-button"
            >
              🔑 设置 API Key
            </button>
          )}
        </div>

        <div className="tips">
          <p><strong>提示：</strong></p>
          <ul>
            <li>首次使用需要设置 OpenAI API Key</li>
            <li>可以先点击"使用示例"查看效果</li>
            <li>生成的歌词会自动填入下方歌词区</li>
            <li>支持 1/16 拍精度，可精确控制每个字的时长</li>
          </ul>
        </div>
      </div>
      )}
    </div>
  );
}
