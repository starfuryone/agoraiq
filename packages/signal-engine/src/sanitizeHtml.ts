// ─────────────────────────────────────────────────────────────────────────────
// sanitizeHtml.ts — Parser-based HTML sanitizer for signal cards
//
// Defense-in-depth for the manual paste endpoint. The deterministic renderer
// is safe by construction; this sanitizes the final HTML before storage.
//
// Install:  pnpm add sanitize-html && pnpm add -D @types/sanitize-html
// ─────────────────────────────────────────────────────────────────────────────

import sanitize from 'sanitize-html'

const ALLOWED_CLASS = /^(signal-|badge-|stop-)/

const OPTIONS: any = {
  allowedTags: ['div', 'span', 'h2', 'h3', 'p', 'ol', 'ul', 'li', 'strong', 'em'],
  allowedAttributes: {
    div: ['class'], span: ['class'], h2: ['class'], h3: ['class'],
    p: ['class'], ol: ['class'], ul: ['class'], li: ['class'],
  },
  allowedStyles: {},
  allowedSchemes: [],
  disallowedTagsMode: 'discard',
  transformTags: {
    '*': (tagName: string, attribs: Record<string, string>) => {
      if (attribs.class) {
        const filtered = attribs.class.split(/\s+/).filter((c: string) => ALLOWED_CLASS.test(c)).join(' ')
        if (filtered) attribs.class = filtered; else delete attribs.class
      }
      return { tagName, attribs }
    },
  },
  exclusiveFilter: (frame: { tag: string }) => new Set([
    'script','style','iframe','object','embed','form','input',
    'textarea','select','button','link','meta','base','svg','math',
  ]).has(frame.tag),
}

export function sanitizeSignalHtml(raw: string): string {
  return sanitize(raw, OPTIONS).trim()
}
