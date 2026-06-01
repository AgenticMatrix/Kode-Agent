// Stub for React Compiler runtime — the `import { c } from 'react/compiler-runtime'`
// lines were inserted by the React Compiler babel plugin in the hermes-tui source.
// We don't run the compiler during tsc build, so provide a no-op stub.
declare module 'react/compiler-runtime' {
  export function c<T>(value: T): T
}

// Bun global used in stringWidth, wrapAnsi, semver for perf detection.
declare var Bun: undefined | {
  isBun?: boolean
  version?: string
  stringWidth?(s: string, opts?: { ambiguousIsNarrow?: boolean }): number
  wrapAnsi?(text: string, columns: number, opts?: Record<string, unknown>): string
  semver: {
    satisfies(version: string, range: string): boolean
    order(a: string, b: string): -1 | 0 | 1
  }
}

// Custom JSX intrinsic elements for the Ink-compatible reconciler.
// These are created by the reconciler's createInstance and must be
// known to TypeScript's JSX type-checker.
declare namespace JSX {
  interface IntrinsicElements {
    'ink-box': Record<string, unknown>
    'ink-text': Record<string, unknown>
    'ink-virtual-text': Record<string, unknown>
    'ink-link': Record<string, unknown>
    'ink-progress': Record<string, unknown>
    'ink-raw-ansi': Record<string, unknown>
  }
}
