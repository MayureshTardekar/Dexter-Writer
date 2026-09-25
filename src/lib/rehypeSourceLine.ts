// Rehype plugin: copy mdast source line numbers onto rendered block elements
// as `data-source-line`, enabling preview → editor inverse search.
// Only transformed (non-markdown) flows should skip it, since their line
// numbers no longer match the original document.

export interface HastLike {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastLike[];
  position?: { start?: { line?: number } };
}

const BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'pre', 'blockquote', 'tr', 'dt', 'dd',
]);

export function attachSourceLines(tree: HastLike): void {
  const walk = (node: HastLike): void => {
    if (node.type === 'element' && node.tagName && BLOCK_TAGS.has(node.tagName)) {
      const line = node.position?.start?.line;
      if (typeof line === 'number') {
        node.properties = { ...node.properties, dataSourceLine: line };
      }
    }
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
}

export function rehypeSourceLine(): (tree: HastLike) => void {
  return (tree: HastLike) => attachSourceLines(tree);
}
