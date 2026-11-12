import { defineConfig } from 'vite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  server: { port: 5173, strictPort: true },
  plugins: [
    {
      name: 'offline-shell',
      apply: 'build',
      closeBundle() {
        const shell = [
          './',
          './icon.svg',
          './manifest.webmanifest',
          './fonts/NotoSansSC-Regular.woff2',
          ...readdirSync('dist/assets').map((file) => './assets/' + file),
        ];
        const worker = readFileSync('public/sw.js', 'utf8').replace(
          /const SHELL = \[[\s\S]*?\];/,
          'const SHELL = ' + JSON.stringify(shell) + ';',
        );
        writeFileSync('dist/sw.js', worker);
      },
    },
  ],
});
