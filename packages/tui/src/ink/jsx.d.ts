// Augment the React JSX namespace (used when jsxImportSource is "react")
// with Ink-compatible custom intrinsic elements.
import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': Record<string, unknown>
      'ink-text': Record<string, unknown>
      'ink-virtual-text': Record<string, unknown>
      'ink-link': Record<string, unknown>
      'ink-progress': Record<string, unknown>
      'ink-raw-ansi': Record<string, unknown>
    }
  }
}
