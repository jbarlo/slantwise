/**
 * Custom bindings shim for CLI distribution.
 * Replaces the `bindings` package to load native modules from our vendor directory.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Get the directory where the CLI bundle is located
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Custom bindings function that loads native modules from vendor directory.
 * Falls back to regular require for development/Electron.
 */
export default function bindings(moduleName: string): unknown {
  const platform = process.platform; // 'darwin', 'linux', 'win32'
  const arch = process.arch; // 'x64', 'arm64'

  // Expected module name: 'better_sqlite3.node'
  const baseName = moduleName.replace('.node', '');

  // Try vendor directory first (CLI distribution)
  // Map module name to vendor directory name: 'better_sqlite3' -> 'better-sqlite3'
  const vendorName = baseName.replace(/_/g, '-');
  const vendorPath = path.join(__dirname, 'vendor', vendorName, `${platform}-${arch}`, moduleName);

  try {
    return require(vendorPath);
  } catch (error) {
    throw new Error(
      `Failed to load native module '${moduleName}' for ${platform}-${arch}.\n` +
        `Expected path: ${vendorPath}\n` +
        `This may indicate a missing prebuilt binary for your platform.\n` +
        `Original error: ${error instanceof Error ? error.message : error}`
    );
  }
}
