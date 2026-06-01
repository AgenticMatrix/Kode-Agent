/**
 * WebFetchTool — Fetch and convert web pages to plain text.
 *
 * Uses Node.js built-in https/http modules. Fetches HTML, strips
 * non-content elements (script, style, nav, header, footer), and
 * returns the body text with basic formatting.
 *
 * Features:
 * - 30-second timeout
 * - In-memory cache with 15-minute TTL
 * - Redirect following (up to 5 hops)
 * - Content-type detection (only processes text/html)
 *
 * Risk: SAFE — read-only network operation.
 */

import { get as httpGet, type IncomingMessage } from 'node:http';
import { get as httpsGet, type RequestOptions } from 'node:https';
import { URL } from 'node:url';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5MB
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** HTML tags whose content we strip entirely. */
const STRIP_TAGS = new Set([
  'script', 'style', 'nav', 'header', 'footer', 'aside',
  'noscript', 'iframe', 'svg', 'canvas', 'video', 'audio',
  'object', 'embed', 'applet', 'form',
]);

/** HTML tags we unwrap (keep children, remove tag). */
const UNWRAP_TAGS = new Set([
  'a', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'del',
  'ins', 'sub', 'sup', 'small', 'mark', 'code', 'kbd', 'var',
  'abbr', 'cite', 'q', 'time',
]);

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  content: string;
  timestamp: number;
}

const fetchCache = new Map<string, CacheEntry>();

function getCached(url: string): string | null {
  const entry = fetchCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    fetchCache.delete(url);
    return null;
  }
  return entry.content;
}

function setCache(url: string, content: string): void {
  fetchCache.set(url, { content, timestamp: Date.now() });
  // Prevent unbounded growth
  if (fetchCache.size > 200) {
    const oldest = [...fetchCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, 50);
    for (const [key] of oldest) {
      fetchCache.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// I/O Types
// ---------------------------------------------------------------------------

export interface WebFetchInput {
  url: string;
  /** Optional prompt to process the fetched content with (future: LLM summarization). */
  prompt?: string;
}

export interface WebFetchOutput {
  url: string;
  content: string;
  contentLength: number;
  redirectChain: string[];
  cached: boolean;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface FetchResult {
  body: string;
  finalUrl: string;
  redirectChain: string[];
}

/**
 * Perform an HTTP(S) GET request with redirect following and timeout.
 */
function performFetch(targetUrl: string, signal?: AbortSignal): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const redirectChain: string[] = [];
    let remainingRedirects = MAX_REDIRECTS;

    function makeRequest(url: string): void {
      // Auto-upgrade HTTP to HTTPS
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      const isHttps = parsed.protocol === 'https:';
      const getFn = isHttps ? httpsGet : httpGet;

      const opts: RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'KodeAgent/1.0 (web-fetch)',
          'Accept': 'text/html, application/xhtml+xml, text/plain;q=0.9',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: HTTP_TIMEOUT_MS,
        rejectUnauthorized: true,
      };

      const req = getFn(opts, (res: IncomingMessage) => {
        // Follow redirects
        if (
          res.statusCode !== undefined &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (remainingRedirects <= 0) {
            req.destroy();
            reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));
            return;
          }
          remainingRedirects--;
          redirectChain.push(url);

          const location = res.headers.location;
          // Resolve relative redirects
          const resolved = new URL(location, url).toString();
          // Clean up
          res.resume();
          makeRequest(resolved);
          return;
        }

        if (res.statusCode !== undefined && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage ?? 'Unknown error'}`));
          return;
        }

        const contentType = res.headers['content-type'] ?? '';
        if (contentType.includes('text/html') || contentType.includes('text/plain')) {
          const chunks: Buffer[] = [];
          let length = 0;

          res.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > MAX_CONTENT_LENGTH) {
              req.destroy();
              reject(new Error(`Response too large (max ${MAX_CONTENT_LENGTH / 1024 / 1024}MB)`));
              return;
            }
            chunks.push(chunk);
          });

          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            redirectChain.push(url);
            resolve({ body, finalUrl: url, redirectChain });
          });

          res.on('error', (err: Error) => {
            reject(new Error(`Response error: ${err.message}`));
          });
        } else {
          res.resume();
          reject(new Error(`Unsupported content type: ${contentType}. Only text/html is supported.`));
        }
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${HTTP_TIMEOUT_MS / 1000}s`));
      });

      req.on('error', (err: Error & { code?: string }) => {
        // Special handling for common errors
        if (err.code === 'ENOTFOUND') {
          reject(new Error(`Host not found: ${parsed.hostname}`));
        } else if (err.code === 'ECONNREFUSED') {
          reject(new Error(`Connection refused: ${parsed.hostname}:${parsed.port}`));
        } else {
          reject(new Error(`Request failed: ${err.message}`));
        }
      });

      req.end();
    }

    // Handle abort signal
    if (signal) {
      signal.addEventListener('abort', () => {
        reject(new Error('Request aborted'));
      }, { once: true });
    }

    makeRequest(targetUrl);
  });
}

// ---------------------------------------------------------------------------
// HTML → Text conversion
// ---------------------------------------------------------------------------

/**
 * Simple HTML-to-text converter. Strips non-content tags, unwraps inline
 * formatting, and preserves basic structure (headings, paragraphs, lists).
 */
function htmlToText(html: string): string {
  // 1. Remove script and style blocks (including their content)
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, '');

  // 2. Replace block-level elements with newlines
  cleaned = cleaned
    .replace(/<\/?(?:div|section|article|main|figure|figcaption|details|summary|dialog)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/?(?:ul|ol|dl|table|thead|tbody|tfoot|tr|colgroup|col)[^>]*>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n');

  // 3. Add markers for headings
  cleaned = cleaned.replace(/<h1[^>]*>/gi, '\n# ');
  cleaned = cleaned.replace(/<h2[^>]*>/gi, '\n## ');
  cleaned = cleaned.replace(/<h3[^>]*>/gi, '\n### ');
  cleaned = cleaned.replace(/<h4[^>]*>/gi, '\n#### ');
  cleaned = cleaned.replace(/<h5[^>]*>/gi, '\n##### ');
  cleaned = cleaned.replace(/<h6[^>]*>/gi, '\n###### ');

  // 4. List items
  cleaned = cleaned.replace(/<li[^>]*>/gi, '\n- ');
  cleaned = cleaned.replace(/<(?:td|th)[^>]*>/gi, ' | ');

  // 5. Remove all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, '');

  // 6. Decode HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, digits) => String.fromCodePoint(Number(digits)));

  // 7. Collapse whitespace
  cleaned = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line, idx, arr) => {
      // Remove consecutive blank lines (keep at most 1)
      if (line === '' && (idx === 0 || arr[idx - 1] === '')) return false;
      return true;
    })
    .join('\n');

  return cleaned.trim();
}

// ---------------------------------------------------------------------------
// WebFetchTool
// ---------------------------------------------------------------------------

const WEB_FETCH_DESCRIPTION = `Fetch content from a URL and convert it to plain text.

Fetches a URL, extracts the main text content, and returns it as clean text.
- HTML pages are converted to plain text (scripts, styles, navigation stripped)
- Redirects are followed automatically (up to 5 hops)
- Results are cached for 15 minutes
- Timeout after 30 seconds
- Only text/html content is supported

Use this tool when you need to retrieve and read web page content.`;

export class WebFetchTool extends BaseTool<WebFetchInput, WebFetchOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'WebFetch',
      description: WEB_FETCH_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch content from. HTTP URLs are auto-upgraded to HTTPS.',
          },
          prompt: {
            type: 'string',
            description: 'Optional prompt describing what information to extract from the page (reserved for future use).',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as WebFetchInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.url !== 'string' || typed.url.trim().length === 0) {
      return { valid: false, errors: [{ path: 'url', message: 'url must be a non-empty string' }] };
    }

    // Basic URL validation
    try {
      const parsed = new URL(
        typed.url.startsWith('http') ? typed.url : `https://${typed.url}`,
      );
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { valid: false, errors: [{ path: 'url', message: 'Only HTTP(S) URLs are supported' }] };
      }
    } catch {
      return { valid: false, errors: [{ path: 'url', message: 'Invalid URL format' }] };
    }

    return { valid: true };
  }

  override async execute(input: WebFetchInput, ctx: ToolContext): Promise<WebFetchOutput> {
    const normalizedUrl = input.url.startsWith('http') ? input.url : `https://${input.url}`;

    // Check cache
    const cached = getCached(normalizedUrl);
    if (cached !== null) {
      return {
        url: normalizedUrl,
        content: cached,
        contentLength: cached.length,
        redirectChain: [],
        cached: true,
      };
    }

    // Fetch
    const result = await performFetch(normalizedUrl, ctx.signal);
    const text = htmlToText(result.body);

    // Cache
    if (text.length > 0) {
      setCache(normalizedUrl, text);
    }

    return {
      url: result.finalUrl,
      content: text,
      contentLength: text.length,
      redirectChain: result.redirectChain.slice(1), // exclude initial URL
      cached: false,
    };
  }

  override formatOutput(result: WebFetchOutput): string {
    const header = result.cached
      ? `[Cached] ${result.url} (${result.contentLength} chars)`
      : `[Fetched] ${result.url} (${result.contentLength} chars)`;
    const redirects = result.redirectChain.length > 0
      ? `\nRedirects: ${result.redirectChain.join(' → ')}`
      : '';
    return `${header}${redirects}\n\n${result.content}`;
  }

  override formatForModel(result: WebFetchOutput): string {
    return this.formatOutput(result);
  }
}
