import { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Extension, Compartment } from '@codemirror/state';
import { cn } from '@shared/client/lib/utils';
import { derivationLanguageExtension } from '../lib/codemirror/derivation-language';
import { createDerivationLinter } from '../lib/codemirror/derivation-lint';
import {
  createDerivationAutocomplete,
  type DerivationForAutocomplete
} from '../lib/codemirror/derivation-autocomplete';
import { formatDocument } from '../lib/codemirror/derivation-format';
import { trpc } from '../utils';
import { UserDerivation } from '@core/db/derivationsService';
import { useTheme } from '../hooks/use-theme';

const formatKeymap = keymap.of([
  { key: 'Shift-Alt-f', run: formatDocument },
  { key: 'Shift-Cmd-f', run: formatDocument },
  { mac: 'Shift-Cmd-f', run: formatDocument }
]);

const snippetFieldTheme = EditorView.theme({
  '.cm-snippetField': {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    outline: '1px solid rgba(59, 130, 246, 0.3)',
    borderRadius: '2px'
  },
  '.cm-snippetFieldPosition': {
    borderLeft: '1.4px solid rgba(59, 130, 246, 0.5)'
  },
  '&': {
    fontSize: '14px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  },
  '.cm-content': {
    minHeight: '100%'
  }
});

// Compartment for dynamically updating linter and autocomplete with derivations data
const derivationsCompartment = new Compartment();

const baseExtensions: Extension[] = [
  formatKeymap,

  // Line wrapping
  EditorView.lineWrapping,

  // Custom theme
  snippetFieldTheme,

  // Derivation language support
  derivationLanguageExtension,

  derivationsCompartment.of([])
];

const basicSetupConfig = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLineGutter: true,
  highlightActiveLine: true,
  highlightSpecialChars: true,
  history: true,
  drawSelection: true,
  dropCursor: true,
  allowMultipleSelections: true,
  indentOnInput: true,
  syntaxHighlighting: true,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: true,
  rectangularSelection: true,
  crosshairCursor: true,
  highlightSelectionMatches: true,
  closeBracketsKeymap: true,
  defaultKeymap: true,
  searchKeymap: true,
  historyKeymap: true,
  foldKeymap: false,
  completionKeymap: true,
  lintKeymap: true
};

const useManageExtensions = (derivations: UserDerivation[]) => {
  const editorViewRef = useRef<EditorView | null>(null);

  const derivationsData = useMemo<DerivationForAutocomplete[]>(() => {
    return derivations.map((d) => ({
      id: d.derivation_id,
      label: d.label,
      operation: d.recipe_params.operation
    }));
  }, [derivations]);

  // Create both linter and autocomplete extensions together
  const derivationsExtensions = useMemo(
    () => [createDerivationLinter(derivationsData), createDerivationAutocomplete(derivationsData)],
    [derivationsData]
  );

  // Combine base extensions with update listener
  const extensions = useMemo<Extension[]>(
    () => [
      ...baseExtensions,
      EditorView.updateListener.of((update) => {
        if (update.view && !editorViewRef.current) {
          editorViewRef.current = update.view;
        }
      })
    ],
    []
  );

  useEffect(() => {
    if (editorViewRef.current) {
      editorViewRef.current.dispatch({
        effects: derivationsCompartment.reconfigure(derivationsExtensions)
      });
    }
  }, [derivationsExtensions]);

  return extensions;
};

interface DerivationCodeMirrorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export const DerivationCodeMirror = ({
  value,
  onChange,
  className,
  placeholder,
  autoFocus
}: DerivationCodeMirrorProps) => {
  const derivationsQuery = trpc.getAllDerivations.useQuery();
  const { resolvedTheme } = useTheme();
  const focusLatchRef = useRef<EditorView | null>(null);

  const extensions = useManageExtensions(derivationsQuery.data ?? []);

  // Capture editor view for focusing
  const extensionsWithFocus = useMemo<Extension[]>(
    () => [
      ...extensions,
      EditorView.updateListener.of((update) => {
        // focus once on mount
        if (update.view && !focusLatchRef.current) {
          focusLatchRef.current = update.view;
          // Focus immediately when editor view is created if autoFocus is enabled
          if (autoFocus) {
            const docLength = update.view.state.doc.length;
            update.view.dispatch({
              selection: { anchor: docLength },
              scrollIntoView: true
            });
            update.view.focus();
          }
        }
      })
    ],
    [extensions, autoFocus]
  );

  return (
    <div
      className={cn(
        'border-input focus-within:border-ring focus-within:ring-ring/50',
        'flex min-h-16 w-full rounded-md border shadow-xs transition-[color,box-shadow]',
        'focus-within:ring-[3px]',
        'resize-y overflow-auto',
        resolvedTheme === 'dark' ? 'bg-[#282c34]' : 'bg-white',
        className
      )}
    >
      <CodeMirror
        className="flex-1"
        value={value}
        onChange={onChange}
        extensions={extensionsWithFocus}
        basicSetup={basicSetupConfig}
        placeholder={placeholder}
        theme={resolvedTheme}
      />
    </div>
  );
};
