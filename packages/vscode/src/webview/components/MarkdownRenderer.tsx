import { h } from 'preact';
import { useMemo, useRef, useEffect, useCallback } from 'preact/hooks';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

interface MarkdownRendererProps {
  text: string;
  onFileClick?: (path: string) => void;
}

export function MarkdownRenderer({ text, onFileClick }: MarkdownRendererProps): h.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    try {
      return marked.parse(text, { async: false }) as string;
    } catch {
      return text;
    }
  }, [text]);

  // Add copy buttons + clickable file paths after render
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Code blocks: add copy buttons ──────────────────────
    const preBlocks = container.querySelectorAll('pre');
    preBlocks.forEach((pre) => {
      if (pre.querySelector('.code-block-copy')) return;

      const code = pre.querySelector('code');
      const lang = code?.className.replace('language-', '') || '';

      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';

      const header = document.createElement('div');
      header.className = 'code-block-header';

      const langSpan = document.createElement('span');
      langSpan.className = 'code-block-lang';
      langSpan.textContent = lang || 'code';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-block-copy';
      copyBtn.textContent = 'Copy';
      copyBtn.onclick = () => {
        const text = code?.textContent || '';
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        }).catch(() => {
          copyBtn.textContent = 'Failed';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        });
      };

      header.appendChild(langSpan);
      header.appendChild(copyBtn);
      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    });

    // ── File paths: make clickable to open in VS Code ───────
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    textNodes.forEach((node) => {
      // Match common file path patterns like src/foo.ts, packages/bar/index.ts
      const filePattern = /\b[\w./-]+\.[\w]{1,6}\b/g;
      const parent = node.parentNode;
      if (!parent) return;
      // Skip code blocks and already-processed nodes
      if (parent.nodeName === 'CODE' || parent.nodeName === 'PRE') return;
      if ((parent as HTMLElement).classList?.contains('file-link')) return;

      const text = node.textContent || '';
      const matches: Array<{ start: number; end: number; path: string }> = [];
      let match;
      while ((match = filePattern.exec(text)) !== null) {
        // Only match plausible file paths (containing / or \)
        if (match[0].includes('/') || match[0].includes('\\')) {
          matches.push({ start: match.index, end: match.index + match[0].length, path: match[0] });
        }
      }

      if (matches.length === 0) return;

      const fragment = document.createDocumentFragment();
      let lastEnd = 0;
      matches.forEach((m) => {
        if (m.start > lastEnd) {
          fragment.appendChild(document.createTextNode(text.slice(lastEnd, m.start)));
        }
        const link = document.createElement('span');
        link.className = 'file-link';
        link.textContent = m.path;
        link.title = `Open ${m.path}`;
        link.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          onFileClick?.(m.path);
        };
        fragment.appendChild(link);
        lastEnd = m.end;
      });
      if (lastEnd < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
      }
      parent.replaceChild(fragment, node);
    });
  }, [html]);

  return <div class="markdown-body" ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />;
}
