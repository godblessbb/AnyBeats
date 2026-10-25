import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 把构建产物收成一个 index.html（JS / CSS 内联）。
 *
 * Alphie 用户画布是 sandbox="allow-scripts" 的不透明源 iframe：外链的 type=module 脚本会按 CORS 拉取
 * （Origin: null），服务器不回 Access-Control-Allow-Origin 就白屏。内联后不依赖服务器怎么配。
 */
function inlineIntoHtml(): Plugin {
  return {
    name: 'anybeats-inline-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'))
      if (!html || html.type !== 'asset') return
      let source = String(html.source)
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          const tag = new RegExp(`<script type="module" crossorigin src="[^"]*${escape(name)}"></script>`)
          const code = file.code.replace(/<\/script/gi, '<\\/script')
          source = source.replace(tag, () => `<script type="module">${code}</script>`)
          delete bundle[name]
        } else if (file.type === 'asset' && name.endsWith('.css')) {
          const tag = new RegExp(`<link rel="stylesheet" crossorigin href="[^"]*${escape(name)}">`)
          source = source.replace(tag, () => `<style>${String(file.source)}</style>`)
          delete bundle[name]
        }
      }
      html.source = source
    },
  }
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), inlineIntoHtml()],
  base: './',
  publicDir: false,
  build: {
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  server: {
    open: true, // 自动打开浏览器
  },
})
