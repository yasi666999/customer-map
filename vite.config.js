import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/* 一期工程化：源码在 src/ 下按模块组织，构建成一个经典的 app.js。
   产物刻意做成 IIFE 而不是 ES module —— 因为 ES module 在 file:// 下会被浏览器
   以跨域为由拦截，而"双击 HTML 就能用"是这个产品不能被牺牲的特性。 */
export default defineConfig({
  base: './',
  // lib 模式下 Vite 不会自动替换 NODE_ENV，不写这行 React 会把开发版打进产物
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: true,
    sourcemap: false,
    lib: {
      entry: 'src/main.js',
      name: 'CustomerMap',
      formats: ['iife'],
      fileName: () => 'app.js',
      cssFileName: 'ui'
    },
    rollupOptions: {
      output: { extend: true }
    }
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node'
  }
});
