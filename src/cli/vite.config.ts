import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { builtinModules } from 'module';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    target: 'node20',
    lib: {
      entry: resolve(__dirname, 'index.ts'),
      formats: ['es'],
      fileName: () => 'cli.mjs'
    },
    outDir: resolve(__dirname, '../../out'),
    rollupOptions: {
      external: [
        'better-sqlite3',
        'inquirer',
        '@parcel/watcher',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`)
      ]
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
