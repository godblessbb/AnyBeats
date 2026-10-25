import { defineConfig } from 'vitest/config';

// 核心逻辑不碰 DOM：用 node 环境跑，DOM 全局不存在，误用会直接报错
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
