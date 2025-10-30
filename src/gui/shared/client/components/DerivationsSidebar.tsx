import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSkeleton,
  SidebarGroup,
  SidebarGroupContent
} from './ui/sidebar';
import { Button } from './ui/button';
import { Plus, FileText } from 'lucide-react';
import type { UserDerivation } from '@core/db/derivationsService';
import { trpc } from '../utils';

interface DerivationsSidebarProps {
  selectedDerivationId: string | null;
  onDerivationSelect: (derivationId: string | null) => void;
}

export const DerivationsSidebar = ({
  selectedDerivationId,
  onDerivationSelect
}: DerivationsSidebarProps) => {
  const derivationsQuery = trpc.getAllDerivations.useQuery();

  const formatDerivationName = (derivation: UserDerivation) => {
    if (derivation.label) {
      return derivation.label;
    }
    const expression = derivation.dsl_expression ?? '';
    return expression.length > 30 ? expression.substring(0, 30) + '...' : expression;
  };

  const formatDerivationDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={() => onDerivationSelect(null)} className="h-8 px-2">
            <Plus className="mr-1 h-4 w-4" />
            New Cell
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {derivationsQuery.isLoading && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                </>
              )}

              {derivationsQuery.error && (
                <SidebarMenuItem>
                  <div className="p-2 text-sm text-red-600">Error loading cells</div>
                </SidebarMenuItem>
              )}

              {derivationsQuery.data?.length === 0 && (
                <SidebarMenuItem>
                  <div className="p-2 text-sm text-gray-500">
                    No cells yet. Create your first one!
                  </div>
                </SidebarMenuItem>
              )}

              {derivationsQuery.data
                ?.sort(
                  (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                )
                ?.map((derivation) => (
                  <SidebarMenuItem key={derivation.derivation_id}>
                    <SidebarMenuButton
                      isActive={selectedDerivationId === derivation.derivation_id}
                      onClick={() => onDerivationSelect(derivation.derivation_id)}
                      className="h-auto w-full justify-start py-0"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                        <span className="w-full truncate text-sm font-medium">
                          {formatDerivationName(derivation)}
                        </span>
                        <span className="text-muted-foreground w-full truncate text-xs">
                          {formatDerivationDate(derivation.created_at)}
                        </span>
                        <span className="text-muted-foreground/70 w-full truncate text-xs">
                          {derivation.derivation_id}
                        </span>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
};
