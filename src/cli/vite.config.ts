import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { builtinModules } from 'module';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '../..');

export default defineConfig({
  build: {
    target: 'node20',
    lib: {
      entry: resolve(__dirname, 'index.ts'),
      formats: ['es'],
      fileName: () => 'cli.mjs'
    },
    outDir: resolve(rootDir, 'out'),
    rollupOptions: {
      external: [
        'inquirer',
        '@parcel/watcher',
        'libsql',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`)
      ],
      output: {
        banner: '#!/usr/bin/env node'
      }
    }
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../core'),
      '@config': resolve(__dirname, '../config'),
      '@lang-data': resolve(__dirname, '../lang-data')
    }
  },
  define: {
    'process.env.CLI_VERSION': JSON.stringify(process.env.npm_package_version)
  }
});
