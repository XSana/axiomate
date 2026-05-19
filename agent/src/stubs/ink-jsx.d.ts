// Stub: declare ink custom JSX intrinsic elements for the agent's
// local ink component copies (Box, Text, Link, RawAnsi, ScrollBox).
// ink is inlined under agent/src/ink, so we declare these here.

import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': any
      'ink-text': any
      'ink-link': any
      'ink-raw-ansi': any
      'ink-virtual-text': any
    }
  }
}
