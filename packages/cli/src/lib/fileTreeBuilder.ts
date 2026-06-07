/**
 * fileTreeBuilder.ts — File tree data model and builder
 *
 * Scans the filesystem and builds a tree of FileNodes for the
 * FileTree component to render. Supports depth limiting, glob-style
 * ignore patterns, and optional git status annotation.
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Git porcelain status short code */
export type GitStatus = 'A' | 'M' | 'D' | 'U' | 'R';

export interface FileNode {
  /** Display name — just the basename */
  name: string;
  /** Full path from the root */
  path: string;
  /** Kind */
  type: 'file' | 'directory';
  /** Child entries (directories only) */
  children?: FileNode[];
  /** Git status — only set when git info is available */
  gitStatus?: GitStatus;
  /** Whether the directory is visually expanded (runtime state) */
  expanded?: boolean;
  /** Nesting depth (root = 0) */
  depth: number;
}

export interface BuildFileTreeOptions {
  /** Maximum directory depth to traverse (default: 3) */
  maxDepth?: number;
  /** Patterns to ignore (directory names to skip entirely) */
  ignorePatterns?: string[];
  /** When true, respects .gitignore patterns (default: false) */
  respectGitignore?: boolean;
}

// ---------------------------------------------------------------------------
// Default ignore set
// ---------------------------------------------------------------------------

const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'build',
  '__pycache__',
  '.DS_Store',
  '.cache',
  'coverage',
  '.turbo',
  '.tsbuildinfo',
]);

// ---------------------------------------------------------------------------
// Sort: directories first, then alphabetical
// ---------------------------------------------------------------------------

function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a file tree from the filesystem.
 *
 * Walks the directory tree starting at `rootPath`, respecting
 * maxDepth and ignore patterns. Directories are expanded by default
 * for the first 2 levels; deeper directories start collapsed.
 *
 * @param rootPath  Absolute or relative path to the project root
 * @param options   Max depth, ignore patterns, git integration
 * @returns         Root FileNode (type: 'directory', children populated)
 */
export function buildFileTree(rootPath: string, options: BuildFileTreeOptions = {}): FileNode {
  const {
    maxDepth = 3,
    ignorePatterns = [],
    respectGitignore = false,
  } = options;

  const ignoreSet = new Set([...DEFAULT_IGNORE, ...ignorePatterns]);

  // Preload gitignore patterns if requested
  const gitignoreGlobs: string[] = [];
  if (respectGitignore) {
    gitignoreGlobs.push(...loadGitignorePatterns(rootPath));
  }

  function shouldIgnore(name: string, fullPath: string, isDir: boolean): boolean {
    // Exact name match against ignore set
    if (ignoreSet.has(name)) return true;

    // Hidden files/dirs (starting with '.') except the root itself
    // We skip .-prefixed entries inside the tree but not the root dir
    if (name.startsWith('.')) return true;

    // Simple gitignore glob matching
    if (respectGitignore && gitignoreGlobs.length > 0) {
      const relPath = relative(rootPath, fullPath) + (isDir ? sep : '');
      for (const pattern of gitignoreGlobs) {
        if (matchSimpleGlob(pattern, relPath)) return true;
      }
    }

    return false;
  }

  function walk(dirPath: string, depth: number): FileNode[] {
    if (depth > maxDepth) return [];

    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      return [];
    }

    const nodes: FileNode[] = [];

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      let isDir: boolean;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        continue; // Skip broken symlinks / permission errors
      }

      if (shouldIgnore(entry, fullPath, isDir)) continue;

      const node: FileNode = {
        name: entry,
        path: fullPath,
        type: isDir ? 'directory' : 'file',
        depth,
        // Directories at depth 0-1 start expanded; deeper ones start collapsed
        expanded: isDir ? depth < 2 : undefined,
      };

      if (isDir) {
        node.children = walk(fullPath, depth + 1);
      }

      nodes.push(node);
    }

    return sortNodes(nodes);
  }

  return {
    name: basename(rootPath) || rootPath,
    path: rootPath,
    type: 'directory',
    depth: 0,
    expanded: true, // Root is always expanded
    children: walk(rootPath, 1),
  };
}

// ---------------------------------------------------------------------------
// Simple glob matching for gitignore
// ---------------------------------------------------------------------------

function loadGitignorePatterns(_rootPath: string): string[] {
  // Placeholder — full gitignore parsing requires reading .gitignore
  // and applying negation/anchoring rules. For the initial implementation,
  // we rely on the explicit ignorePatterns option.
  return [];
}

/**
 * Minimal glob matching for gitignore-style patterns.
 * Supports: trailing-slash directory marker, leading-slash anchoring,
 * single-star (*) and double-star (**).
 */
function matchSimpleGlob(pattern: string, candidate: string): boolean {
  let p = pattern;
  let c = candidate;

  // Trailing / means "only match directories"
  const dirOnly = p.endsWith('/');
  if (dirOnly) {
    p = p.slice(0, -1);
  }

  // Leading / anchors to root
  if (p.startsWith('/')) {
    p = p.slice(1);
  }

  // Convert glob to regex
  const regexStr = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
    .replace(/\*\*\//g, '(?:.*/)?')         // **/ matches zero or more dirs
    .replace(/\*\*/g, '.*')                 // ** matches anything
    .replace(/\*/g, '[^/]*')               // * matches anything except /
    .replace(/\?/g, '[^/]');               // ? matches single non-slash

  const re = new RegExp(`^(?:.*/)?${regexStr}${dirOnly ? '/?$' : '$'}`);
  return re.test(c);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Toggle a node's expanded state in-place by path.
 * Returns true if the node was found and toggled.
 */
export function toggleNode(tree: FileNode, targetPath: string): boolean {
  if (tree.path === targetPath && tree.type === 'directory') {
    tree.expanded = !tree.expanded;
    return true;
  }

  if (tree.children) {
    for (const child of tree.children) {
      if (toggleNode(child, targetPath)) return true;
    }
  }

  return false;
}

/**
 * Find a node by its path in the tree.
 */
export function findNode(tree: FileNode, targetPath: string): FileNode | undefined {
  if (tree.path === targetPath) return tree;

  if (tree.children) {
    for (const child of tree.children) {
      const found = findNode(child, targetPath);
      if (found) return found;
    }
  }

  return undefined;
}
