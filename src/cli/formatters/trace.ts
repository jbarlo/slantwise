import { DependencyTree, ExecutionTree } from '@core/db/types.js';

export type ContentResolver = (hash: string) => string | undefined;

export interface FormatTraceOptions {
  full?: boolean;
}

const TRUNCATE_LENGTH = 60;

const truncate = (str: string, full: boolean): string => {
  if (full) return str;
  const oneLine = str.replace(/\n/g, '\\n');
  if (oneLine.length <= TRUNCATE_LENGTH) return oneLine;
  return oneLine.slice(0, TRUNCATE_LENGTH) + '...';
};

const formatCacheStatus = (wasCached: boolean): string => {
  return wasCached ? '[cached]' : '[computed]';
};

type TreeNode = {
  label: string;
  cacheStatus?: string;
  value?: string;
  children: TreeNode[];
};

const dependencyToNode = (
  dep: DependencyTree[number],
  resolveContent: ContentResolver,
  opts: FormatTraceOptions
): TreeNode => {
  if (dep.type === 'content' || dep.type === 'pinned_path' || dep.type === 'constant') {
    const content = resolveContent(dep.contentHash);
    const label =
      dep.type === 'constant' ? 'constant' : dep.type === 'pinned_path' ? 'pinned_path' : 'content';
    return {
      label,
      value: content
        ? truncate(content, opts.full ?? false)
        : `<hash: ${dep.contentHash.slice(0, 8)}>`,
      children: []
    };
  }

  // derivation or computed_step - TypeScript needs explicit narrowing here
  if (dep.type === 'derivation' || dep.type === 'computed_step') {
    const content = resolveContent(dep.contentHash);
    return {
      label: dep.operation,
      cacheStatus: formatCacheStatus(dep.wasCached),
      value: content ? truncate(content, opts.full ?? false) : undefined,
      children: dep.dependencies.map((child: DependencyTree[number]) =>
        dependencyToNode(child, resolveContent, opts)
      )
    };
  }

  // Should never reach here, but TypeScript needs exhaustive check
  throw new Error(`Unexpected dependency type: ${(dep as { type: string }).type}`);
};

const executionTreeToNode = (
  tree: ExecutionTree,
  resolveContent: ContentResolver,
  opts: FormatTraceOptions
): TreeNode => {
  const content = resolveContent(tree.contentHash);
  return {
    label: tree.operation,
    cacheStatus: formatCacheStatus(tree.wasCached),
    value: content ? truncate(content, opts.full ?? false) : undefined,
    children: tree.dependencies.map((dep) => dependencyToNode(dep, resolveContent, opts))
  };
};

const renderTree = (
  node: TreeNode,
  prefix: string = '',
  isLast: boolean = true,
  isRoot: boolean = true
): string => {
  const lines: string[] = [];

  // Current node line
  const connector = isRoot ? '' : isLast ? '└─ ' : '├─ ';
  let line = prefix + connector + node.label;
  if (node.cacheStatus) {
    line += ' ' + node.cacheStatus;
  }
  lines.push(line);

  // Value line (if present)
  if (node.value !== undefined) {
    const valuePrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    lines.push(valuePrefix + '→ "' + node.value + '"');
  }

  // Children
  const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
  node.children.forEach((child, i) => {
    const childIsLast = i === node.children.length - 1;
    lines.push(renderTree(child, childPrefix, childIsLast, false));
  });

  return lines.join('\n');
};

/**
 * Formats an ExecutionTree as a human-readable trace.
 *
 * @param tree - The execution tree returned by getOrComputeDerivedContent
 * @param resolveContent - Function to look up content by hash
 * @param opts - Formatting options
 * @returns A formatted string representation of the trace
 */
export const formatExecutionTrace = (
  tree: ExecutionTree,
  resolveContent: ContentResolver,
  opts: FormatTraceOptions = {}
): string => {
  const rootNode = executionTreeToNode(tree, resolveContent, opts);
  return renderTree(rootNode);
};
