/**
 * Abstraction for detecting system theme changes across different platforms.
 * Implementations handle platform-specific detection (browser API, Electron, etc.)
 */
export interface SystemThemeDetector {
  /**
   * Subscribe to system theme changes.
   * @param callback Called when system theme changes, with true for dark mode
   * @returns Cleanup function to unsubscribe
   */
  subscribe(callback: (isDark: boolean) => void): () => void;
}
