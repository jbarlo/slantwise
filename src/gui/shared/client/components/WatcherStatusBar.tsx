import { useEffect, useState } from 'react';
import { Eye, FileSearch, AlertCircle, CheckCircle } from 'lucide-react';

interface WatcherStatusUpdate {
  status: 'idle' | 'scanning' | 'watching' | 'error';
  message: string;
  fileCount?: number;
  error?: string;
}

// Type for Electron API (subset used by this component)
interface ElectronAPI {
  system?: {
    getWatcherStatus?: () => Promise<WatcherStatusUpdate>;
    onWatcherStatusChange?: (callback: (status: WatcherStatusUpdate) => void) => () => void;
  };
}

// Extend window with optional Electron API
interface WindowWithAPI extends Window {
  api?: ElectronAPI;
}

// Type guard for Electron environment
function isElectronEnvironment(): boolean {
  return (
    typeof window !== 'undefined' &&
    'api' in window &&
    typeof (window as WindowWithAPI).api === 'object'
  );
}

export function WatcherStatusBar() {
  const [status, setStatus] = useState<WatcherStatusUpdate>({
    status: 'idle',
    message: 'Initializing...'
  });

  useEffect(() => {
    // Only setup listener if we're in Electron environment
    if (isElectronEnvironment()) {
      const api = (window as WindowWithAPI).api;

      // Request initial status
      if (api?.system?.getWatcherStatus) {
        api.system
          .getWatcherStatus()
          .then((initialStatus) => {
            setStatus(initialStatus);
          })
          .catch((error) => {
            console.error('Failed to get initial watcher status:', error);
          });
      }

      // Subscribe to future updates
      if (api?.system?.onWatcherStatusChange) {
        const unsubscribe = api.system.onWatcherStatusChange((update: WatcherStatusUpdate) => {
          setStatus(update);
        });

        return unsubscribe;
      }
    }
  }, []);

  const getStatusIcon = () => {
    switch (status.status) {
      case 'scanning':
        return <FileSearch className="h-3.5 w-3.5 animate-pulse" />;
      case 'watching':
        return <Eye className="h-3.5 w-3.5" />;
      case 'error':
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
      case 'idle':
        return <CheckCircle className="h-3.5 w-3.5" />;
    }
  };

  const getStatusColor = () => {
    switch (status.status) {
      case 'scanning':
        return 'text-blue-600 dark:text-blue-400';
      case 'watching':
        return 'text-green-600 dark:text-green-400';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      case 'idle':
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="flex h-6 items-center border-t bg-muted/30 px-3 text-xs">
      <div className={`flex items-center gap-1.5 ${getStatusColor()}`}>
        {getStatusIcon()}
        <span className="font-medium">{status.message}</span>
        {status.fileCount !== undefined && (
          <span className="text-muted-foreground ml-1">({status.fileCount})</span>
        )}
        {status.error && (
          <span className="text-red-500 ml-2 truncate max-w-xs" title={status.error}>
            - {status.error}
          </span>
        )}
      </div>
    </div>
  );
}
