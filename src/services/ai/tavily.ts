export interface WebSearchSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface TavilySearchResult {
  query: string;
  answer?: string;
  sources: WebSearchSource[];
  formattedContext: string;
}

interface RawTavilyResponse {
  query?: string;
  answer?: string;
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
}

const TAVILY_API_KEY = process.env.EXPO_PUBLIC_TAVILY_API_KEY || '';
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const TAVILY_TIMEOUT_MS = 12000;

export function isTavilyConfigured(): boolean {
  return Boolean(TAVILY_API_KEY.trim());
}

/**
 * Executes a live web search via the Tavily API and formats the findings
 * for the DeepSeek Care Assistant.
 */
export async function searchTavily(query: string): Promise<TavilySearchResult | null> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || !isTavilyConfigured()) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);

  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY.trim(),
        query: trimmedQuery,
        search_depth: 'basic',
        include_answer: true,
        max_results: 4,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(
        `[Tavily] Search failed with HTTP ${response.status}: ${errText.slice(0, 160)}`
      );
      return null;
    }

    const data = (await response.json()) as RawTavilyResponse;
    const sources: WebSearchSource[] = (data.results ?? [])
      .filter((r) => Boolean(r?.title && r?.url))
      .slice(0, 4)
      .map((r) => ({
        title: (r.title ?? '').trim(),
        url: (r.url ?? '').trim(),
        snippet: (r.content ?? '').trim().slice(0, 320),
      }));

    const lines: string[] = [];
    if (data.answer && data.answer.trim()) {
      lines.push(`Summary: ${data.answer.trim()}`);
    }
    sources.forEach((s, idx) => {
      lines.push(`[${idx + 1}] ${s.title} (${s.url}): ${s.snippet ?? ''}`);
    });

    const formattedContext = lines.join('\n').trim();
    if (!formattedContext) {
      return null;
    }

    return {
      query: trimmedQuery,
      answer: data.answer?.trim(),
      sources,
      formattedContext,
    };
  } catch (err) {
    console.warn(
      `[Tavily] Search error for "${trimmedQuery}":`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
