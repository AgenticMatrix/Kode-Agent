/**
 * Memory types — types for the FTS5-backed cross-session memory system.
 *
 * Agent memory system with SQLite FTS5 for efficient retrieval.
 * Architecture reference: ARCHITECTURE.md §4.10
 */

// ---------------------------------------------------------------------------
// Memory Type
// ---------------------------------------------------------------------------

export enum MemoryType {
  /** User preferences, coding style, personal conventions */
  USER_PROFILE = 'user_profile',
  /** Project-specific context: architecture decisions, tech stack, conventions */
  PROJECT_CONTEXT = 'project_context',
  /** User corrections, feedback on agent behavior */
  FEEDBACK = 'feedback',
  /** Reference material: documentation snippets, code patterns, URLs */
  REFERENCE = 'reference',
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface Memory {
  /** Unique ID (UUID) */
  id: string;
  /** Memory classification */
  type: MemoryType;
  /** The memory content (plain text) */
  content: string;
  /** Keywords for search indexing */
  keywords: string[];
  /** Source: session ID or 'manual' */
  source: string;
  /** Working directory when the memory was created */
  cwd?: string;
  /** Importance score 0-1 (higher = more important) */
  importance: number;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt: string;
  /** Number of times this memory was accessed */
  accessCount: number;
}

// ---------------------------------------------------------------------------
// Memory Search Query
// ---------------------------------------------------------------------------

export interface MemoryQuery {
  /** Free-text query for keyword / FTS5 search */
  query?: string;
  /** Filter by memory type */
  type?: MemoryType | MemoryType[];
  /** Filter by source session */
  source?: string;
  /** Filter by working directory prefix */
  cwd?: string;
  /** Minimum importance threshold (0-1) */
  minImportance?: number;
  /** Maximum number of results */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Memory Input (for creation)
// ---------------------------------------------------------------------------

export interface MemoryInput {
  type: MemoryType;
  content: string;
  keywords?: string[];
  source: string;
  cwd?: string;
  importance?: number;
}

// ---------------------------------------------------------------------------
// Search Result
// ---------------------------------------------------------------------------

export interface MemorySearchResult {
  memory: Memory;
  /** Relevance score 0-1 (1 = exact match) */
  score: number;
}
