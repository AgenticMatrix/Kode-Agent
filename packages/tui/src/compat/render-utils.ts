/**
 * Render utility compat stubs — Phase 0
 *
 * renderSync and createRoot are CA-specific extensions that don't exist
 * in standard Ink. Phase 0 wraps the standard Ink render.
 */
import React from 'react';
import { render as inkRender } from 'ink';
import type { RenderOptions } from 'ink';

/**
 * Synchronous render — Phase 0 stub delegates to async render.
 * In the full implementation this would block until the first paint.
 */
export function renderSync(
  node: React.ReactElement,
  options?: RenderOptions,
) {
  // Phase 0: delegate to the standard render.
  // Full implementation would render synchronously (blocking)
  // for use cases that need a fully painted screen before continuing.
  return inkRender(node, options);
}

/**
 * Create a root without rendering — Phase 0 stub creates via render.
 * The original CA createRoot returned a root object with a render method.
 * Phase 0 returns the Ink Instance directly.
 */
export function createRoot(
  node: React.ReactElement,
  options?: RenderOptions,
) {
  return inkRender(node, options);
}
