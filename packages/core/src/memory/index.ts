/**
 * @kode/core/memory — Barrel export for the Memory system.
 *
 * Exports types, store, extractor, and consolidator.
 * Architecture reference: ARCHITECTURE.md §4.10
 */

// Types
export {
  MemoryType,
  type Memory,
  type MemoryQuery,
  type MemoryInput,
  type MemorySearchResult,
} from './types.js';

// Store
export {
  createMemoryStore,
  JsonMemoryStore,
  extractKeywords,
  type IMemoryStore,
} from './store.js';

// Extractor
export {
  MemoryExtractor,
  extractMemories,
  type ExtractionResult,
  type ExtractionOptions,
} from './extractor.js';

// Consolidator
export {
  MemoryConsolidator,
  consolidateStore,
  type ConsolidationResult,
  type ConsolidationOptions,
  type MergeDetail,
} from './consolidator.js';
