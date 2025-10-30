import { Button } from './ui/button';
import { useState } from 'react';
import { isNil } from 'lodash-es';
import { DerivationCodeMirror } from './DerivationCodeMirror';
import { trpc } from '../utils';
import { Streamdown } from 'streamdown';

interface DerivationEditorProps {
  selectedDerivationId: string | null;
  initialExpression: string;
  onDerivationCreated: (derivationId: string) => Promise<void>;
  onDerivationUpdated: (derivationId: string, expression: string) => Promise<void>;
}

export const DerivationEditor = ({
  selectedDerivationId,
  initialExpression,
  onDerivationCreated,
  onDerivationUpdated
}: DerivationEditorProps) => {
  const [expression, setExpression] = useState(initialExpression);

  const createMutation = trpc.createDerivation.useMutation();
  const updateMutation = trpc.updateDerivation.useMutation();
  const readQuery = trpc.readDerivation.useQuery(
    { derivationId: selectedDerivationId ?? '' },
    {
      enabled: !isNil(selectedDerivationId),
      // disable caching/retries for immediate error responses since relying on
      // sqlite anyways
      //
      // TODO return error type instead
      retry: false,
      gcTime: 0,
      staleTime: 0
    }
  );

  const mode = !isNil(selectedDerivationId) ? 'update' : 'create';
  const dispatchMutation = mode === 'create' ? createMutation : updateMutation;

  const isCalculating = dispatchMutation.isPending || readQuery.isFetching;

  const isInexecutable = !expression.trim() || isCalculating;

  const handleExecute = async () => {
    if (isInexecutable) {
      return;
    }

    try {
      if (!isNil(selectedDerivationId)) {
        await updateMutation.mutateAsync({
          derivationId: selectedDerivationId,
          expression
        });
        await onDerivationUpdated(selectedDerivationId, expression);
        await readQuery.refetch();
      } else {
        const derivationId = await createMutation.mutateAsync({ expression });
        await onDerivationCreated(derivationId);
      }
    } catch {
      // TODO error handling
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <DerivationCodeMirror
        value={expression}
        onChange={setExpression}
        placeholder="Enter formula"
      />
      <div className="flex justify-end gap-2">
        <Button onClick={handleExecute} disabled={isInexecutable}>
          {mode === 'update'
            ? dispatchMutation.isPending
              ? 'Updating...'
              : 'Update'
            : dispatchMutation.isPending
              ? 'Creating...'
              : 'Create'}
        </Button>
      </div>

      {dispatchMutation.error && (
        <div className="rounded border border-red-200 bg-red-50 p-3">
          <div className="text-sm font-medium text-red-800">Error:</div>
          <div className="text-sm whitespace-pre-wrap text-red-700">
            {dispatchMutation.error?.message}
          </div>
        </div>
      )}

      {mode === 'update' && (
        <div className="space-y-2">
          {isCalculating && <div className="text-sm text-gray-500">Loading output...</div>}

          {readQuery.error && (
            <div className="rounded border border-red-200 bg-red-50 p-3">
              <div className="text-sm font-medium text-red-800">Read Error:</div>
              <div className="text-sm whitespace-pre-wrap text-red-700">
                {readQuery.error.message}
              </div>
            </div>
          )}

          {readQuery.data && (
            <div className="rounded border p-3">
              <Streamdown>{readQuery.data}</Streamdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
