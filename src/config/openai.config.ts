/**
 * AI API 配置文件
 * 支持 DeepSeek 和 OpenAI 模型
 * API Key 从环境变量读取
 */

export interface AIConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens?: number;
}

// 支持的模型列表
export const AVAILABLE_MODELS = [
  { value: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek' },
  { value: 'gpt-5-nano', label: 'GPT-5 Nano', provider: 'openai' },
];

// 模型对应的 API 端点
export const API_ENDPOINTS: Record<string, string> = {
  'deepseek': 'https://api.deepseek.com/v1/chat/completions',
  'openai': 'https://api.openai.com/v1/chat/completions',
};

export interface LyricJsonTemplate {
  bpm: number;
  timeSignature: string;
  measures: Array<{
    measureIndex: number;
    lyrics: Array<{
      text: string;
      startBeat: number;
      duration: number;
    }>;
  }>;
}

/**
 * 默认配置
 */
export const defaultOpenAIConfig: Omit<AIConfig, 'apiKey'> = {
  model: 'deepseek-chat', // 默认使用 DeepSeek
  temperature: 0.8,
  maxTokens: 2000,
};

/**
 * 获取模型对应的 provider
 */
export const getModelProvider = (model: string): string => {
  const modelInfo = AVAILABLE_MODELS.find(m => m.value === model);
  return modelInfo?.provider || 'openai';
};

/**
 * 获取 API 端点
 */
export const getApiEndpoint = (model: string): string => {
  const provider = getModelProvider(model);
  return API_ENDPOINTS[provider] || API_ENDPOINTS['openai'];
};

/**
 * 根据模型获取对应的 API Key（从环境变量读取）
 */
export const getApiKey = (model: string): string => {
  const provider = getModelProvider(model);
  if (provider === 'deepseek') {
    return import.meta.env.VITE_DEEPSEEK_API_KEY || '';
  }
  return import.meta.env.VITE_GPT_API_KEY || '';
};

/**
 * 系统级 Prompt 模板
 */
export const getSystemPrompt = (bpm: number): string => {
  return `你是一个专业的说唱歌词创作助手。请根据用户的需求生成说唱歌词，并严格按照以下JSON格式输出：

${getJsonTemplate(bpm)}

重要说明：
1. startBeat 和 duration 都以 1/16拍为单位
2. 每小节有64个1/16拍（4/4拍 = 4拍 = 64个1/16拍）
3. 常用时值：
   - 1/16拍 = 1 单位
   - 1/8拍 = 2 单位
   - 1/4拍 = 4 单位
   - 1/2拍 = 8 单位
   - 1拍 = 16 单位
4. 字数与拍号的关系：
   - 1个字通常占 1/4拍（4个单位）
   - 2个字通常占 1/8拍每字（2个单位每字）
   - 3-4个字通常占 1/16拍每字（1个单位每字）
   - 5-8个字占 1/32拍每字（建议避免，除非是极快的说唱）
5. 请合理分配每个字/词的时值：
   - 快速说唱可用 1/16拍 或 1/8拍
   - 中速说唱可用 1/4拍
   - 慢速说唱可用 1/2拍 或 1拍
6. 生成2-4个小节的内容
7. 确保每个小节的歌词时值总和不超过64
8. 只返回JSON，不要有其他文字

请现在根据用户需求创作歌词。`;
};

/**
 * JSON 模板字符串
 */
export const getJsonTemplate = (bpm: number): string => {
  const template: LyricJsonTemplate = {
    bpm: bpm,
    timeSignature: "4/4",
    measures: [
      {
        measureIndex: 0,
        lyrics: [
          { text: "我", startBeat: 0, duration: 4 },
          { text: "走", startBeat: 4, duration: 4 },
          { text: "在", startBeat: 8, duration: 4 },
          { text: "街上", startBeat: 12, duration: 4 }
        ]
      }
    ]
  };
  return JSON.stringify(template, null, 2);
};

/**
 * 获取存储的模型选择
 */
export const getStoredModel = (): string => {
  return localStorage.getItem('ai_model') || 'deepseek-chat';
};

/**
 * 保存模型选择
 */
export const saveModel = (model: string): void => {
  localStorage.setItem('ai_model', model);
};
