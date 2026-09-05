import { getConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export interface ResearchResult {
  title: string;
  url: string;
  publishedDate: string | null;
  excerpt: string;
}

export interface ResearchDigest {
  available: boolean;
  query: string;
  results: ResearchResult[];
  /** Prose digest handed to the model. Never invented. */
  digest: string;
  /** Why research is unavailable, when it is. */
  unavailableReason: string | null;
}

const TAVILY_URL = 'https://api.tavily.com/search';
const MAX_RESULTS = 8;
const EXCERPT_LENGTH = 400;

interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string; published_date?: string; score?: number }[];
}

/**
 * Searches Tavily for current material. A failure is never fatal: the caller
 * gets `available: false` and must fall back to an evergreen topic and say so.
 */
export async function researchCurrentTopics(
  options: { query?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ResearchDigest> {
  const config = getConfig();
  const query = options.query ?? config.CONTENT_RESEARCH_QUERY;
  const doFetch = options.fetchImpl ?? fetch;

  if (config.TAVILY_API_KEY === '') {
    return unavailable(query, 'TAVILY_API_KEY is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await doFetch(TAVILY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        max_results: MAX_RESULTS,
        search_depth: 'advanced',
        topic: 'news',
        days: 14,
        include_answer: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await safeText(response);
      logger.warn('Tavily search failed', { httpStatus: response.status, body: body.slice(0, 200) });
      return unavailable(query, `Tavily returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as TavilyResponse;
    const results: ResearchResult[] = (payload.results ?? [])
      .filter((item) => typeof item.url === 'string' && typeof item.title === 'string')
      .slice(0, MAX_RESULTS)
      .map((item) => ({
        title: (item.title ?? '').trim(),
        url: (item.url ?? '').trim(),
        publishedDate: item.published_date ? item.published_date.trim() : null,
        excerpt: (item.content ?? '').trim().slice(0, EXCERPT_LENGTH),
      }))
      // Prefer results that carry a publication date — they are checkable.
      .sort((a, b) => Number(Boolean(b.publishedDate)) - Number(Boolean(a.publishedDate)));

    if (results.length === 0) {
      return unavailable(query, 'Tavily returned no usable results.');
    }

    return {
      available: true,
      query,
      results,
      digest: buildDigest(results),
      unavailableReason: null,
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? 'Tavily request timed out.'
        : `Tavily request failed: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn('Tavily search error', { reason });
    return unavailable(query, reason);
  } finally {
    clearTimeout(timeout);
  }
}

function unavailable(query: string, reason: string): ResearchDigest {
  return { available: false, query, results: [], digest: '', unavailableReason: reason };
}

function buildDigest(results: ResearchResult[]): string {
  return results
    .map((result, index) => {
      const date = result.publishedDate ? ` (published ${result.publishedDate})` : ' (no date given)';
      return `${index + 1}. ${result.title}${date}\n   ${result.url}\n   ${result.excerpt}`;
    })
    .join('\n');
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export function assertTavilyConfigured(): void {
  if (getConfig().TAVILY_API_KEY === '') {
    throw new AppError('config_missing', 'TAVILY_API_KEY is not configured.');
  }
}
