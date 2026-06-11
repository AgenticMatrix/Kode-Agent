import { h } from 'preact';
import { useMemo, useRef, useEffect } from 'preact/hooks';
import { marked } from 'marked';
import katex from 'katex';

marked.setOptions({
  breaks: true,
  gfm: true,
});

interface MarkdownRendererProps {
  text: string;
  onFileClick?: (path: string) => void;
}

const MATH_PLACEHOLDERS: string[] = [];

function protectMath(md: string): string {
  MATH_PLACEHOLDERS.length = 0;
  // Display math: $$...$$ and \[...\]
  let result = md.replace(/\$\$([\s\S]*?)\$\$/g, storeDisplayMath);
  result = result.replace(/\\\[([\s\S]*?)\\\]/g, storeDisplayMath);
  // Inline math: $...$ and \(...\)
  result = result.replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, storeInlineMath);
  result = result.replace(/\\\(([\s\S]*?)\\\)/g, storeInlineMath);
  return result;
}

function storeDisplayMath(_m: string, formula: string): string {
  const idx = MATH_PLACEHOLDERS.length;
  MATH_PLACEHOLDERS.push(`<span class="katex-display">${katex.renderToString(formula.trim(), { displayMode: true, throwOnError: false })}</span>`);
  return `\x00MATH${idx}\x00`;
}

function storeInlineMath(_m: string, formula: string): string {
  const idx = MATH_PLACEHOLDERS.length;
  MATH_PLACEHOLDERS.push(`<span class="katex-inline">${katex.renderToString(formula.trim(), { displayMode: false, throwOnError: false })}</span>`);
  return `\x00MATH${idx}\x00`;
}

function restoreMath(html: string): string {
  return html.replace(/\x00MATH(\d+)\x00/g, (_m: string, idx: string) => {
    return MATH_PLACEHOLDERS[parseInt(idx, 10)] || '';
  });
}

export function MarkdownRenderer({ text, onFileClick }: MarkdownRendererProps): h.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    try {
      const protected_text = protectMath(text);
      const html = marked.parse(protected_text, { async: false }) as string;
      return restoreMath(html);
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
        const t = code?.textContent || '';
        navigator.clipboard.writeText(t).then(() => {
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

    // ── File paths: make clickable ─────────────────────────
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

    textNodes.forEach((node) => {
      const filePattern = /\b[\w./-]+\.[\w]{1,6}\b/g;
      const parent = node.parentNode;
      if (!parent) return;
      if (parent.nodeName === 'CODE' || parent.nodeName === 'PRE') return;
      if ((parent as HTMLElement).classList?.contains('file-link')) return;

      const nodeText = node.textContent || '';
      const matches: Array<{ start: number; end: number; path: string }> = [];
      let match;
      while ((match = filePattern.exec(nodeText)) !== null) {
        if (match[0].includes('/') || match[0].includes('\\')) {
          matches.push({ start: match.index, end: match.index + match[0].length, path: match[0] });
        }
      }
      if (matches.length === 0) return;

      const fragment = document.createDocumentFragment();
      let lastEnd = 0;
      matches.forEach((m) => {
        if (m.start > lastEnd) fragment.appendChild(document.createTextNode(nodeText.slice(lastEnd, m.start)));
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
      if (lastEnd < nodeText.length) fragment.appendChild(document.createTextNode(nodeText.slice(lastEnd)));
      parent.replaceChild(fragment, node);
    });
  }, [html]);

  return <div class="markdown-body" ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />;
}
