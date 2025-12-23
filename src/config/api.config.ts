/**
 * 后端API配置
 */

// 韵脚后端API地址
export const RHYME_API_BASE = import.meta.env.VITE_RHYME_API_URL || 'http://localhost:8000';

// API端点
export const RHYME_API = {
  search: `${RHYME_API_BASE}/rhyme`,
  stats: `${RHYME_API_BASE}/stats`,
  rhymes: `${RHYME_API_BASE}/rhymes`,
  health: `${RHYME_API_BASE}/`,
};
