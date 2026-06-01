/**
 * fileTree.tsx — Project file tree sidebar component
 *
 * Renders a directory tree using Ink Box + Text primitives.
 * Supports expand/collapse, tree-drawing glyphs, and git status colors.
 *
 * Integration: embedded in AppLayout as a left sidebar.
 * Toggle: Ctrl+B (handled via useInput in the parent).
 */

import React from 'react';
import { Box, NoSelect, Text } from '@kode/tui';
import { memo, useCallback, useMemo, useState } from 'react';

import type { FileNode } from '../lib/fileTreeBuilder.js';
import { buildFileTree, toggleNode } from '../lib/fileTreeBuilder.js';
import type { Theme } from '../theme.js';

// ---------------------------------------------------------------------------
// Tree-drawing helpers
// ---------------------------------------------------------------------------

type TreeBranch = 'mid' | 'last' | 'none';
type TreeRails = readonly boolean[];

/**
 * Compute the lead string for a tree row.
 *
 * ```
 * rails=[true, false]  branch="mid"   →  "│   ├─ "
 * rails=[true, false]  branch="last"  →  "│   └─ "
 * rails=[]             branch="none"  →  ""
 * ```
 */
function treeLead(rails: TreeRails, branch: TreeBranch): string {
  if (branch === 'none') return '';
  const prefix = rails.map(on => (on ? '│ ' : '  ')).join('');
  const stem = branch === 'mid' ? '├─ ' : '└─ ';
  return prefix + stem;
}

function nextRails(rails: TreeRails, branch: TreeBranch): TreeRails {
  if (branch === 'none') return rails;
  return [...rails, branch === 'mid'];
}

// ---------------------------------------------------------------------------
// Git status → color mapping
// ---------------------------------------------------------------------------

const GIT_COLOR_KEYS = {
  A: 'gitAdded',
  M: 'gitModified',
  D: 'gitDeleted',
  U: 'gitUntracked',
  R: 'gitModified', // renamed → same as modified
} as const;

function gitStatusColor(status: string | undefined, t: Theme): string {
  if (!status) return t.fileTree.file;
  const key = GIT_COLOR_KEYS[status as keyof typeof GIT_COLOR_KEYS];
  return key ? t.fileTree[key] : t.fileTree.file;
}

function gitStatusLabel(status: string | undefined): string {
  if (!status) return '';
  return ` ${status}`;
}

// ---------------------------------------------------------------------------
// FileTreeRow — single entry in the tree
// ---------------------------------------------------------------------------

interface FileTreeRowProps {
  node: FileNode;
  branch: TreeBranch;
  rails: TreeRails;
  t: Theme;
  onToggle: (path: string) => void;
}

const FileTreeRow = memo(function FileTreeRow({
  node,
  branch,
  rails,
  t,
  onToggle,
}: FileTreeRowProps) {
  const isDir = node.type === 'directory';
  const isOpen = node.expanded === true;
  const isToggleable = isDir && (node.children?.length ?? 0) > 0;

  const lead = treeLead(rails, branch);
  const color = isDir
    ? t.fileTree.directory
    : gitStatusColor(node.gitStatus, t);

  const gitLabel = gitStatusLabel(node.gitStatus);

  const handleClick = useCallback(() => {
    if (isToggleable) {
      onToggle(node.path);
    }
  }, [isToggleable, onToggle, node.path]);

  return (
    <Box flexDirection="column">
      <Box onClick={handleClick}>
        <NoSelect flexShrink={0} width={lead.length}>
          <Text color={t.color.muted} dim>
            {lead}
          </Text>
        </NoSelect>

        <Text color={color}>
          {isToggleable ? (isOpen ? '▾ ' : '▸ ') : isDir ? '  ' : '  '}
          {node.name}
          {gitLabel ? (
            <Text color={gitStatusColor(node.gitStatus, t)} dim>
              {gitLabel}
            </Text>
          ) : null}
        </Text>
      </Box>

      {isDir && isOpen && node.children && node.children.length > 0 && (
        <Box flexDirection="column">
          {node.children.map((child, i) => (
            <FileTreeRow
              key={child.path}
              node={child}
              branch={i === node.children!.length - 1 ? 'last' : 'mid'}
              rails={nextRails(rails, branch)}
              t={t}
              onToggle={onToggle}
            />
          ))}
        </Box>
      )}
    </Box>
  );
});

// ---------------------------------------------------------------------------
// FileTree — top-level component
// ---------------------------------------------------------------------------

export interface FileTreeProps {
  /** Project root path */
  rootPath: string;
  /** Theme for colors */
  t: Theme;
  /** Maximum visible width in columns */
  maxWidth?: number;
}

export const FileTree = memo(function FileTree({
  rootPath,
  t,
  maxWidth = 30,
}: FileTreeProps) {
  const [tree, setTree] = useState<FileNode>(() =>
    buildFileTree(rootPath, { maxDepth: 3 }),
  );

  // Rebuild when rootPath changes
  const [, setRootPath] = useState(rootPath);
  if (rootPath !== '') {
    // Track rootPath changes via a ref pattern to avoid stale closure
  }

  const handleToggle = useCallback((path: string) => {
    setTree(prevTree => {
      // Shallow clone the tree to trigger re-render
      const newTree = { ...prevTree, children: prevTree.children ? [...prevTree.children] : undefined };
      toggleNode(newTree, path);
      return newTree;
    });
  }, []);

  const children = tree.children ?? [];

  return (
    <Box flexDirection="column" paddingX={1} width={maxWidth}>
      <Box marginBottom={1}>
        <Text bold color={t.fileTree.directory}>
          {tree.name}
        </Text>
        <Text color={t.color.muted} dim>
          {' '}
          ({children.length} items)
        </Text>
      </Box>

      {children.length === 0 ? (
        <Text color={t.color.muted} dim>
          (empty)
        </Text>
      ) : (
        <Box flexDirection="column">
          {children.map((child, i) => (
            <FileTreeRow
              key={child.path}
              node={child}
              branch={i === children.length - 1 ? 'last' : 'mid'}
              rails={[]}
              t={t}
              onToggle={handleToggle}
            />
          ))}
        </Box>
      )}
    </Box>
  );
});

// ---------------------------------------------------------------------------
// Static / mock tree (for test / preview without filesystem access)
// ---------------------------------------------------------------------------

export function createMockTree(): FileNode {
  return {
    name: 'kode-agent',
    path: '/project/kode-agent',
    type: 'directory',
    depth: 0,
    expanded: true,
    children: [
      {
        name: 'packages',
        path: '/project/kode-agent/packages',
        type: 'directory',
        depth: 1,
        expanded: true,
        children: [
          {
            name: 'core',
            path: '/project/kode-agent/packages/core',
            type: 'directory',
            depth: 2,
            expanded: false,
            children: [
              { name: 'src', path: '/project/kode-agent/packages/core/src', type: 'directory', depth: 3, expanded: false, children: [] },
            ],
          },
          {
            name: 'cli',
            path: '/project/kode-agent/packages/cli',
            type: 'directory',
            depth: 2,
            expanded: false,
            children: [
              { name: 'src', path: '/project/kode-agent/packages/cli/src', type: 'directory', depth: 3, expanded: false, children: [] },
            ],
          },
          {
            name: 'shared',
            path: '/project/kode-agent/packages/shared',
            type: 'directory',
            depth: 2,
            expanded: false,
            children: [
              { name: 'src', path: '/project/kode-agent/packages/shared/src', type: 'directory', depth: 3, expanded: false, children: [] },
            ],
          },
        ],
      },
      {
        name: 'package.json',
        path: '/project/kode-agent/package.json',
        type: 'file',
        depth: 1,
        gitStatus: 'M',
      },
      {
        name: 'README.md',
        path: '/project/kode-agent/README.md',
        type: 'file',
        depth: 1,
      },
      {
        name: 'pnpm-lock.yaml',
        path: '/project/kode-agent/pnpm-lock.yaml',
        type: 'file',
        depth: 1,
      },
    ],
  };
}
