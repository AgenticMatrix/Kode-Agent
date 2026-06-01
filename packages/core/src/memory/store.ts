/**
 * MemoryStore — SQLite FTS5 cross-session memory with JSON fallback.
 *
 * Primary implementation: better-sqlite3 with WAL mode and FTS5 virtual table.
 * Fallback: JSON file at ~/.kode/memory.json with keyword-based search.
 *
 * Architecture reference: ARCHITECTURE.md §4.10
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  MemoryType,
  type Memory,
  type MemoryQuery,
  type MemoryInput,
  type MemorySearchResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Store Interface
// ---------------------------------------------------------------------------

/**
 * Contract for a memory store implementation.
 *
 * Implementations:
 *   - SqliteMemoryStore — better-sqlite3 + FTS5 (when native module available)
 *   - JsonMemoryStore — JSON file fallback (always available)
 */
export interface IMemoryStore {
  /** Full-text / keyword search with relevance scoring */
  search(query: string, limit?: number): MemorySearchResult[];

  /** Advanced query with type filter, importance threshold, etc. */
  query(q: MemoryQuery): MemorySearchResult[];

  /** Save a new memory (auto-generates ID and timestamps) */
  save(input: MemoryInput): Memory;

  /** Update an existing memory */
  update(id: string, updates: Partial<Omit<Memory, 'id' | 'createdAt'>>): Memory | null;

  /** Delete a memory by ID */
  delete(id: string): boolean;

  /** Get a memory by ID */
  get(id: string): Memory | null;

  /** Get all memories (with optional limit) */
  list(limit?: number): Memory[];

  /**
   * Select relevant memories for the current conversation context.
   * Extracts keywords from messages and matches against stored memories.
   */
  selectRelevant(messages: Array<{ role: string; content: string | unknown }>, limit?: number): MemorySearchResult[];

  /** Get total memory count */
  get count(): number;
}

// ---------------------------------------------------------------------------
// JSON File Fallback Store
// ---------------------------------------------------------------------------

const DEFAULT_DB_PATH = join(homedir(), '.kode', 'memory.json');

/**
 * JSON-file based memory store.
 *
 * Stores memories as a JSON array at ~/.kode/memory.json.
 * Search uses keyword matching on content + keywords fields.
 * Designed as a drop-in fallback when better-sqlite3 is unavailable.
 *
 * Thread-safe via atomic write (write to temp, rename, delete temp).
 */
export class JsonMemoryStore implements IMemoryStore {
  private filePath: string;
  private cache: Memory[] | null = null;
  private cacheDirty = false;

  constructor(dbPath?: string) {
    this.filePath = dbPath ?? DEFAULT_DB_PATH;
  }

  // ── Search ──────────────────────────────────────────────────────

  search(query: string, limit = 10): MemorySearchResult[] {
    const memories = this.loadAll();
    if (!query.trim()) {
      return memories.slice(0, limit).map((m) => ({ memory: m, score: 1 }));
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored: MemorySearchResult[] = [];

    for (const m of memories) {
      const score = this.computeRelevance(m, terms);
      if (score > 0) {
        scored.push({ memory: m, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  query(q: MemoryQuery): MemorySearchResult[] {
    let results = this.search(q.query ?? '', q.limit ?? 10);

    // Filter by type
    if (q.type) {
      const types = Array.isArray(q.type) ? q.type : [q.type];
      results = results.filter((r) => types.includes(r.memory.type));
    }

    // Filter by source
    if (q.source) {
      results = results.filter((r) => r.memory.source === q.source);
    }

    // Filter by cwd prefix
    if (q.cwd) {
      results = results.filter((r) => !r.memory.cwd || r.memory.cwd.startsWith(q.cwd!));
    }

    // Filter by min importance
    if (q.minImportance !== undefined) {
      results = results.filter((r) => r.memory.importance >= q.minImportance!);
    }

    return results.slice(0, q.limit ?? 10);
  }

  // ── CRUD ────────────────────────────────────────────────────────

  save(input: MemoryInput): Memory {
    const now = new Date().toISOString();
    const memory: Memory = {
      id: randomUUID(),
      type: input.type,
      content: input.content,
      keywords: input.keywords ?? extractKeywords(input.content),
      source: input.source,
      cwd: input.cwd,
      importance: input.importance ?? 0.5,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    };

    const all = this.loadAll();
    all.push(memory);
    this.writeAll(all);

    return memory;
  }

  update(id: string, updates: Partial<Omit<Memory, 'id' | 'createdAt'>>): Memory | null {
    const all = this.loadAll();
    const index = all.findIndex((m) => m.id === id);
    if (index === -1) return null;

    const existing = all[index]!;
    const updated: Memory = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      keywords: updates.content
        ? extractKeywords(updates.content)
        : updates.keywords ?? existing.keywords,
    };

    all[index] = updated;
    this.writeAll(all);

    return updated;
  }

  delete(id: string): boolean {
    const all = this.loadAll();
    const index = all.findIndex((m) => m.id === id);
    if (index === -1) return false;

    all.splice(index, 1);
    this.writeAll(all);
    return true;
  }

  get(id: string): Memory | null {
    const all = this.loadAll();
    const memory = all.find((m) => m.id === id) ?? null;

    if (memory) {
      this.incrementAccessCount(memory);
    }

    return memory;
  }

  list(limit = 100): Memory[] {
    const all = this.loadAll();
    return all.slice(-limit);
  }

  // ── selectRelevant ──────────────────────────────────────────────

  selectRelevant(
    messages: Array<{ role: string; content: string | unknown }>,
    limit = 5,
  ): MemorySearchResult[] {
    // Extract all text from messages
    const allText = messages
      .map((m) => {
        if (typeof m.content === 'string') return m.content;
        if (Array.isArray(m.content)) {
          return (m.content as Array<{ text?: string; content?: string }>)
            .map((b) => b.text ?? b.content ?? '')
            .join(' ');
        }
        return '';
      })
      .join(' ');

    if (!allText.trim()) return [];

    // Extract significant keywords (longer words, skip common stopwords)
    const queryTerms = extractSignificantTerms(allText);
    if (queryTerms.length === 0) return [];

    // Search using extracted terms
    const results = this.search(queryTerms.join(' '), limit * 2);

    // Boost by importance and recency
    for (const r of results) {
      r.score = r.score * 0.5 + r.memory.importance * 0.3 + this.recencyBoost(r.memory) * 0.2;
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  // ── Count ───────────────────────────────────────────────────────

  get count(): number {
    return this.loadAll().length;
  }

  // ── Internal ────────────────────────────────────────────────────

  private loadAll(): Memory[] {
    if (this.cache !== null && !this.cacheDirty) return this.cache;

    try {
      if (!existsSync(this.filePath)) {
        this.cache = [];
        return this.cache;
      }
      const raw = readFileSync(this.filePath, 'utf-8');
      this.cache = JSON.parse(raw) as Memory[];
      return this.cache;
    } catch {
      this.cache = [];
      return this.cache;
    }
  }

  private writeAll(memories: Memory[]): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Atomic write: write to temp file, rename, clean up
    const tmpPath = this.filePath + '.tmp';
    const bakPath = this.filePath + '.bak';

    writeFileSync(tmpPath, JSON.stringify(memories, null, 2), 'utf-8');

    // Backup existing file if present
    if (existsSync(this.filePath)) {
      try { renameSync(this.filePath, bakPath); } catch { /* ok */ }
    }

    try {
      renameSync(tmpPath, this.filePath);
    } catch {
      // Restore backup on failure
      if (existsSync(bakPath)) {
        try { renameSync(bakPath, this.filePath); } catch { /* ok */ }
      }
      throw new Error('Failed to write memory store');
    }

    // Clean up
    if (existsSync(bakPath)) {
      try { unlinkSync(bakPath); } catch { /* ok */ }
    }
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* ok */ }
    }

    this.cache = memories;
    this.cacheDirty = false;
  }

  private computeRelevance(memory: Memory, terms: string[]): number {
    const content = memory.content.toLowerCase();
    const keywords = memory.keywords.map((k) => k.toLowerCase());
    let score = 0;

    for (const term of terms) {
      // Content matches (case-insensitive)
      const contentMatches = (content.match(new RegExp(escapeRegex(term), 'gi')) ?? []).length;
      score += contentMatches * 2;

      // Keyword matches (higher weight)
      for (const kw of keywords) {
        if (kw.includes(term) || term.includes(kw)) {
          score += 5;
        }
      }
    }

    // Normalize by term count
    return Math.min(1, score / (terms.length * 10));
  }

  private recencyBoost(memory: Memory): number {
    const age = Date.now() - new Date(memory.createdAt).getTime();
    const days = age / (24 * 60 * 60 * 1000);
    // Exponential decay: 1 at creation, ~0.1 after 90 days
    return Math.exp(-days / 90);
  }

  private incrementAccessCount(memory: Memory): void {
    memory.accessCount++;
    memory.updatedAt = new Date().toISOString();
    this.cacheDirty = true;
    // Defer write — will be flushed on next writeAll or we can flush now
    const all = this.loadAll();
    const idx = all.findIndex((m) => m.id === memory.id);
    if (idx !== -1) {
      all[idx] = memory;
      this.writeAll(all);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — auto-detect best implementation
// ---------------------------------------------------------------------------

let _sqliteAvailable: boolean | null = null;

function isSqliteAvailable(): boolean {
  if (_sqliteAvailable !== null) return _sqliteAvailable;
  try {
    // Dynamic import check — TypeScript will tree-shake this if not used
    require('better-sqlite3');
    _sqliteAvailable = true;
  } catch {
    _sqliteAvailable = false;
  }
  return _sqliteAvailable;
}

/**
 * Create the best available MemoryStore implementation.
 *
 * Tries better-sqlite3 first; falls back to JSON file store.
 * The JSON store is always available and requires no native dependencies.
 */
export function createMemoryStore(dbPath?: string): IMemoryStore {
  if (isSqliteAvailable()) {
    // SQLite path — defined in sqlite-store.ts (loaded lazily)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SqliteMemoryStore } = require('./sqlite-store.js');
      return new SqliteMemoryStore(dbPath);
    } catch {
      // Fall through to JSON fallback
    }
  }
  return new JsonMemoryStore(dbPath);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract simple keywords from text content.
 */
export function extractKeywords(text: string, maxKeywords = 10): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_.\/#@]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .filter((w) => !STOPWORDS.has(w));

  // Count frequency, pick top N
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([w]) => w);
}

/**
 * Extract significant terms from text (for selectRelevant).
 * Filters out short words and common stopwords.
 */
function extractSignificantTerms(text: string, maxTerms = 8): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_.\/#@]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .filter((w) => !STOPWORDS.has(w))
    .filter((w) => !/^\d+$/.test(w)); // Skip pure numbers

  const unique = [...new Set(words)];
  return unique.slice(0, maxTerms);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
  'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'from',
  'they', 'that', 'this', 'with', 'what', 'when', 'were', 'which',
  'will', 'your', 'been', 'each', 'more', 'some', 'than', 'then',
  'into', 'like', 'just', 'also', 'over', 'such', 'only', 'other',
  'very', 'much', 'well', 'even', 'most', 'make', 'made', 'does',
  'being', 'about', 'after', 'their', 'there', 'these', 'those',
  'would', 'could', 'should', 'where', 'while',
]);
