import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { builtinModules } from 'module';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '../..');

/**
 * Plugin to copy vendor binaries to the output directory
 */
function copyVendorPlugin(): Plugin {
  return {
    name: 'copy-vendor',
    closeBundle() {
      const vendorSrc = resolve(rootDir, 'vendor');
      const vendorDest = resolve(rootDir, 'out/vendor');

      // Recursively copy vendor directory
      function copyDir(src: string, dest: string) {
        mkdirSync(dest, { recursive: true });
        for (const entry of readdirSync(src)) {
          const srcPath = resolve(src, entry);
          const destPath = resolve(dest, entry);
          if (statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath);
          } else {
            copyFileSync(srcPath, destPath);
          }
        }
      }

      try {
        copyDir(vendorSrc, vendorDest);
        console.log('Copied vendor binaries to out/vendor');
      } catch (e) {
        console.warn('Warning: Could not copy vendor binaries:', e);
      }
    }
  };
}

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
        // Keep native module externals - they'll be loaded from vendor at runtime
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
      '@lang-data': resolve(__dirname, '../lang-data'),
      // Replace bindings with our shim for CLI distribution
      bindings: resolve(__dirname, 'bindings-shim.ts')
    }
  },
  plugins: [copyVendorPlugin()],
  define: {
    'process.env.CLI_VERSION': JSON.stringify(process.env.npm_package_version)
  }
});
