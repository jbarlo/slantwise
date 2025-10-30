import type { SystemThemeDetector } from '@shared/client/lib/theme/types';

/**
 * Electron implementation of SystemThemeDetector.
 * Uses Electron's nativeTheme API via IPC bridge to detect OS theme changes.
 */
export class ElectronThemeDetector implements SystemThemeDetector {
  subscribe(callback: (isDark: boolean) => void): () => void {
    if (!window.api?.system.onThemeChange) {
      console.warn('ElectronThemeDetector: window.api.system.onThemeChange not available');
      return () => {};
    }

    return window.api.system.onThemeChange(callback);
  }
}
