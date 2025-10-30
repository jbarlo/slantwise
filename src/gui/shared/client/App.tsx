import type { TRPCClient } from '@trpc/client';
import type { AppRouter } from '../server';
import type { SystemThemeDetector } from './lib/theme/types';
import './styles/globals.css';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SidebarProvider, SidebarInset, SidebarTrigger } from './components/ui/sidebar';
import { DerivationsSidebar } from './components/DerivationsSidebar';
import { DerivationEditor } from './components/DerivationEditor';
import { ThemeProvider } from './components/theme-provider';
import { ModeToggle } from './components/mode-toggle';
import { trpc } from './utils';

const AppContent = () => {
  const [selectedDerivationId, setSelectedDerivationId] = useState<string | null>(null);
  const derivationsQuery = trpc.getAllDerivations.useQuery();

  const handleDerivationSelect = (derivationId: string | null) => {
    setSelectedDerivationId(derivationId);
  };

  const handleDerivationCreated = async (derivationId: string) => {
    // Refetch first to ensure the new derivation is in the cache
    await derivationsQuery.refetch();

    // Then switch to the new derivation (or null if empty)
    if (derivationId === '') {
      setSelectedDerivationId(null);
    } else {
      setSelectedDerivationId(derivationId);
    }
  };

  const handleDerivationUpdated = async () => {
    await derivationsQuery.refetch();
  };

  const selectedDerivation = derivationsQuery.data?.find(
    (d) => d.derivation_id === selectedDerivationId
  );
  const initialExpression = selectedDerivation?.dsl_expression ?? '';

  return (
    <SidebarProvider>
      <DerivationsSidebar
        selectedDerivationId={selectedDerivationId}
        onDerivationSelect={handleDerivationSelect}
      />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="flex-1 text-lg font-semibold">
            {selectedDerivationId ? `Cell ${selectedDerivationId}` : 'New Cell'}
          </div>
          <ModeToggle />
        </header>
        <DerivationEditor
          key={selectedDerivationId}
          selectedDerivationId={selectedDerivationId}
          initialExpression={initialExpression}
          onDerivationCreated={handleDerivationCreated}
          onDerivationUpdated={handleDerivationUpdated}
        />
      </SidebarInset>
    </SidebarProvider>
  );
};

interface AppProps {
  trpcClient: TRPCClient<AppRouter>;
  themeDetector: SystemThemeDetector;
}

const App = ({ trpcClient, themeDetector }: AppProps) => {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="system" storageKey="slantwise-theme" detector={themeDetector}>
          <AppContent />
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
};

export default App;
