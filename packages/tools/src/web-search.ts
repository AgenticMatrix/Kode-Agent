/**
 * WebSearchTool — Search the web via DuckDuckGo Instant Answer API.
 *
 * Uses DuckDuckGo's free API (no API key required). Returns top results
 * from RelatedTopics and AbstractText. Supports domain allow/block lists.
 *
 * Limitations:
 * - DuckDuckGo's API is rate-limited; no official SLA
 * - Results are from DuckDuckGo's index, not real-time
 * - No pagination support
 *
 * Risk: SAFE — read-only network operation.
 */

import { get as httpsGet, type RequestOptions } from 'node:https';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@coder/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DDG_API_BASE = 'api.duckduckgo.com';
const DDG_API_PATH = '/';
const HTTP_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 10;
const MIN_QUERY_LENGTH = 2;

// ---------------------------------------------------------------------------
// I/O Types
// ---------------------------------------------------------------------------

export interface WebSearchInput {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string; // DuckDuckGo's "FirstURL" or icon URL
}

export interface WebSearchOutput {
  query: string;
  results: SearchResult[];
  abstract?: string;       // DuckDuckGo's AbstractText (instant answer)
  abstractSource?: string; // Source URL for the abstract
  totalResults: number;
  filteredOut: number;     // Results filtered by domain rules
}

// ---------------------------------------------------------------------------
// DuckDuckGo API Types
// ---------------------------------------------------------------------------

interface DDGRelatedTopic {
  Result: string;    // HTML snippet with link
  Text: string;      // Plain text description
  FirstURL: string;  // URL
  Icon?: { URL: string };
}

interface DDGResponse {
  AbstractText?: string;
  AbstractSource?: string;
  AbstractURL?: string;
  Heading?: string;
  Answer?: string;
  AnswerType?: string;
  RelatedTopics?: (DDGRelatedTopic | { Name?: string; Topics?: DDGRelatedTopic[] })[];
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

function ddgSearch(query: string, signal?: AbortSignal): Promise<DDGResponse> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ q: query, format: 'json', no_html: '1' });
    const path = `${DDG_API_PATH}?${params.toString()}`;

    const opts: RequestOptions = {
      hostname: DDG_API_BASE,
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'CoderAgent/1.0 (web-search)',
        'Accept': 'application/json',
      },
      timeout: HTTP_TIMEOUT_MS,
    };

    const req = httpsGet(opts, (res) => {
      if (res.statusCode !== undefined && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`DuckDuckGo API returned HTTP ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          const data = JSON.parse(body) as DDGResponse;
          resolve(data);
        } catch (err) {
          reject(new Error(`Failed to parse DuckDuckGo response: ${err instanceof Error ? err.message : String(err)}`));
        }
      });
      res.on('error', (err: Error) => reject(new Error(`Response error: ${err.message}`)));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`DuckDuckGo request timed out after ${HTTP_TIMEOUT_MS / 1000}s`));
    });

    req.on('error', (err: Error & { code?: string }) => {
      if (err.code === 'ENOTFOUND') {
        reject(new Error('DuckDuckGo API host not found — check network connectivity'));
      } else {
        reject(new Error(`DuckDuckGo request failed: ${err.message}`));
      }
    });

    if (signal) {
      signal.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true });
    }

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Result parsing
// ---------------------------------------------------------------------------

/**
 * Extract the display URL from DuckDuckGo's HTML snippet.
 */
function extractUrlFromSnippet(htmlSnippet: string): string {
  const match = htmlSnippet.match(/href="([^"]+)"/);
  if (match && match[1]) {
    return match[1];
  }
  return '';
}

/**
 * Flatten DuckDuckGo's nested RelatedTopics into a flat list.
 */
function flattenTopics(
  topics: DDGResponse['RelatedTopics'],
): DDGRelatedTopic[] {
  if (!topics) return [];
  return topics.flatMap((topic) => {
    if ('Name' in topic && topic.Topics) {
      return topic.Topics;
    }
    return [topic as DDGRelatedTopic];
  });
}

/**
 * Extract domain from a URL for filtering.
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// WebSearchTool
// ---------------------------------------------------------------------------

const WEB_SEARCH_DESCRIPTION = `Search the web using DuckDuckGo and return results.

Returns up to ${MAX_RESULTS} search results with title, URL, and snippet.
- Supports domain allow-listing (allowed_domains) and block-listing (blocked_domains)
- Includes instant answers (Abstract) when available
- No API key required

Use this tool to search for current information on the web.`;

export class WebSearchTool extends BaseTool<WebSearchInput, WebSearchOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'WebSearch',
      description: WEB_SEARCH_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: `The search query. Must be at least ${MIN_QUERY_LENGTH} characters.`,
          },
          allowed_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only include results from these domains (e.g. ["github.com", "docs.rs"])',
          },
          blocked_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Exclude results from these domains (e.g. ["pinterest.com"])',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as WebSearchInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.query !== 'string' || typed.query.trim().length < MIN_QUERY_LENGTH) {
      return {
        valid: false,
        errors: [{
          path: 'query',
          message: `query must be a non-empty string with at least ${MIN_QUERY_LENGTH} characters`,
        }],
      };
    }
    return { valid: true };
  }

  override async execute(input: WebSearchInput, ctx: ToolContext): Promise<WebSearchOutput> {
    const query = input.query.trim();

    // Fetch from DuckDuckGo
    const ddgResponse = await ddgSearch(query, ctx.signal);

    // Flatten topics
    const allTopics = flattenTopics(ddgResponse.RelatedTopics);

    // Parse into SearchResult list
    let results: SearchResult[] = allTopics.map((topic) => ({
      title: topic.Text.length > 100 ? topic.Text.slice(0, 97) + '...' : topic.Text,
      url: topic.FirstURL || extractUrlFromSnippet(topic.Result),
      snippet: topic.Result?.replace(/<[^>]*>/g, '') ?? topic.Text,
      source: topic.Icon?.URL,
    }));

    // Domain filtering
    const allowedDomains = input.allowed_domains?.map((d) => d.toLowerCase());
    const blockedDomains = input.blocked_domains?.map((d) => d.toLowerCase());
    let filteredOut = 0;

    if (allowedDomains && allowedDomains.length > 0) {
      const allowed = new Set(allowedDomains);
      const before = results.length;
      results = results.filter((r) => {
        const domain = extractDomain(r.url);
        return allowed.has(domain) || allowed.has(domain.replace(/^www\./, ''));
      });
      filteredOut += before - results.length;
    }

    if (blockedDomains && blockedDomains.length > 0) {
      const blocked = new Set(blockedDomains);
      const before = results.length;
      results = results.filter((r) => {
        const domain = extractDomain(r.url);
        return !blocked.has(domain) && !blocked.has(domain.replace(/^www\./, ''));
      });
      filteredOut += before - results.length;
    }

    // Truncate to max results
    const truncated = results.length > MAX_RESULTS;
    if (truncated) {
      results = results.slice(0, MAX_RESULTS);
    }

    return {
      query,
      results,
      abstract: ddgResponse.AbstractText || ddgResponse.Answer,
      abstractSource: ddgResponse.AbstractSource || ddgResponse.AbstractURL,
      totalResults: results.length,
      filteredOut,
    };
  }

  override formatOutput(result: WebSearchOutput): string {
    const lines: string[] = [];
    lines.push(`Search results for: "${result.query}"`);

    if (result.abstract) {
      lines.push(`\n📌 ${result.abstract}`);
      if (result.abstractSource) {
        lines.push(`   Source: ${result.abstractSource}`);
      }
    }

    lines.push(`\nResults (${result.totalResults}${result.filteredOut > 0 ? `, ${result.filteredOut} filtered` : ''}):`);

    for (let i = 0; i < result.results.length; i++) {
      const r = result.results[i]!;
      lines.push(`\n${i + 1}. ${r.title}`);
      lines.push(`   ${r.url}`);
      if (r.snippet) lines.push(`   ${r.snippet.slice(0, 200)}`);
    }

    return lines.join('\n');
  }

  override formatForModel(result: WebSearchOutput): string {
    return this.formatOutput(result);
  }
}
