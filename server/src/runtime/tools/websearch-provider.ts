import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { prisma } from "../../db.js";
import { config } from "../../env.js";
import type { RunContext } from "./run-context.js";
import type { ToolDescriptor, ToolProvider } from "./registry.js";
import type { RuntimeTool } from "./types.js";

/** 网页工具：webSearch（多引擎搜索，免 key 时降级到网页抓取）与
 * webFetch（读取网页正文为 Markdown）。结果结构参考 aime-chat 的
 * WebSearch/WebFetch：统一归一化为 {title,url,snippet}，异构后端只在
 * 本文件内消化，模型与前端只看归一化结构。 */

const MAX_RESULTS = 10;
const SNIPPET_MAX_CHARS = 500;
const SEARCH_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 30_000;
const WEBFETCH_CONTENT_LIMIT = 40_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

type SearchEngineId = "zhipu" | "bocha" | "tavily" | "brave" | "sogou" | "duckduckgo";

const SEARCH_ENGINES: ReadonlySet<string> = new Set([
  "zhipu",
  "bocha",
  "tavily",
  "brave",
  "sogou",
  "duckduckgo",
]);

function currentMonthLabel(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

function clip(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** 尽力而为的 HTML → 纯文本：剥掉 script/style 与全部标签，还原常见实体。 */
function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 带 key 的搜索后端
// ---------------------------------------------------------------------------

async function zhipuSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/web_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      search_engine: "search_std",
      search_query: query,
      search_intent: false,
      count: MAX_RESULTS,
      search_recency_filter: "noLimit",
      content_size: "medium",
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`zhipu web_search HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    search_result?: Array<{ title?: string; link?: string; content?: string }>;
    data?: { search_result?: Array<{ title?: string; link?: string; content?: string }> };
  };
  const rows = payload.search_result ?? payload.data?.search_result ?? [];
  return rows
    .map((row) => ({
      title: String(row.title ?? ""),
      url: String(row.link ?? ""),
      snippet: clip(String(row.content ?? ""), SNIPPET_MAX_CHARS),
    }))
    .filter((row) => row.url.startsWith("http"));
}

async function bochaSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetch("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, summary: true, count: MAX_RESULTS, freshness: "noLimit" }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`bocha web-search HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: {
      webPages?: { value?: Array<{ name?: string; url?: string; summary?: string }> };
      web?: { pages?: Array<{ name?: string; url?: string; summary?: string }> };
    };
  };
  const rows = payload.data?.webPages?.value ?? payload.data?.web?.pages ?? [];
  return rows
    .map((row) => ({
      title: String(row.name ?? ""),
      url: String(row.url ?? ""),
      snippet: clip(String(row.summary ?? ""), SNIPPET_MAX_CHARS),
    }))
    .filter((row) => row.url.startsWith("http"));
}

async function tavilySearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: MAX_RESULTS }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`tavily search HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (payload.results ?? [])
    .map((row) => ({
      title: String(row.title ?? ""),
      url: String(row.url ?? ""),
      snippet: clip(String(row.content ?? ""), SNIPPET_MAX_CHARS),
    }))
    .filter((row) => row.url.startsWith("http"));
}

async function braveSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`brave search HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (payload.web?.results ?? [])
    .map((row) => ({
      title: String(row.title ?? ""),
      url: String(row.url ?? ""),
      snippet: clip(String(row.description ?? ""), SNIPPET_MAX_CHARS),
    }))
    .filter((row) => row.url.startsWith("http"));
}

// ---------------------------------------------------------------------------
// 免 key 兜底：直接抓搜索结果页 HTML（参考 aime-chat 的 sogou 兜底）
// ---------------------------------------------------------------------------

function unwrapDuckduckgoHref(href: string): string {
  if (!href.startsWith("//duckduckgo.com/l/")) return href.startsWith("//") ? `https:${href}` : href;
  try {
    const params = new URLSearchParams(href.split("?")[1] ?? "");
    const target = params.get("uddg");
    return target ? decodeURIComponent(target) : href;
  } catch {
    return href;
  }
}

function parseDuckduckgoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1);
  for (const block of blocks) {
    const anchor = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!anchor) continue;
    const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const url = unwrapDuckduckgoHref(anchor[1]);
    if (!url.startsWith("http")) continue;
    results.push({
      title: clip(stripTags(anchor[2]), 200),
      url,
      snippet: clip(snippetMatch ? stripTags(snippetMatch[1]) : "", SNIPPET_MAX_CHARS),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

async function duckduckgoSearch(query: string): Promise<SearchResult[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`duckduckgo HTML HTTP ${response.status}`);
  }
  const results = parseDuckduckgoHtml(await response.text());
  if (results.length === 0) throw new Error("duckduckgo HTML returned no results");
  return results;
}

/** 搜狗的跳转链接（/link?url=…）需要再请求一次才能还原真实地址：
 * 优先取重定向后的 response.url，失败再从返回页里正则提取 location.replace。 */
async function resolveSogouLink(href: string): Promise<string> {
  const absolute = href.startsWith("http") ? href : `https://www.sogou.com${href}`;
  if (!absolute.includes("/link?")) return absolute;
  try {
    const response = await fetch(absolute, {
      headers: { "User-Agent": BROWSER_UA, Referer: "https://www.sogou.com/" },
      redirect: "follow",
      signal: AbortSignal.timeout(6_000),
    });
    if (response.url && !response.url.includes("sogou.com/link")) return response.url;
    const body = await response.text();
    const replaced = /window\.location\.replace\("([^"]+)"\)/.exec(body);
    if (replaced) return replaced[1];
  } catch {
    // 解析失败就保留跳转链接，页面仍可通过搜狗中转打开
  }
  return absolute;
}

function parseSogouHtml(html: string): Array<{ title: string; href: string; snippet: string }> {
  const rows: Array<{ title: string; href: string; snippet: string }> = [];
  const blocks = html.split(/<div[^>]+class="vrwrap|<div[^>]+class="rb"/).slice(1);
  for (const block of blocks) {
    const anchor = /<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!anchor) continue;
    const href = decodeEntities(anchor[1]);
    if (!href || href.startsWith("javascript")) continue;
    // 摘要没有稳定的选择器：去掉标题区后取剩余可见文本的开头一段。
    // 属性值内嵌 ">" 会让标签剥离留下 '">' 残片，一并清掉；再砍掉搜狗
    // 结果块尾部的“推荐您搜索”相关搜索词。
    const rest = block.replace(anchor[0], "").replace(/<h3[\s\S]*?<\/h3>/gi, " ");
    const snippet = stripTags(rest)
      .replace(/(?:["'>]+\s*)+/g, " ")
      .split("推荐您搜索")[0];
    rows.push({
      title: clip(stripTags(anchor[2]), 200),
      href,
      snippet: clip(snippet, SNIPPET_MAX_CHARS),
    });
    if (rows.length >= MAX_RESULTS) break;
  }
  return rows;
}

async function sogouSearch(query: string): Promise<SearchResult[]> {
  const response = await fetch(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`sogou web HTTP ${response.status}`);
  }
  const rows = parseSogouHtml(await response.text());
  if (rows.length === 0) throw new Error("sogou returned no results");
  return Promise.all(
    rows.map(async (row) => ({
      title: row.title,
      url: await resolveSogouLink(row.href),
      snippet: row.snippet,
    })),
  );
}

// ---------------------------------------------------------------------------
// 引擎与 key 解析
// ---------------------------------------------------------------------------

/** 复用已配置的智谱模型 Provider 的 key 调 web_search/reader，
 * 用户配了智谱模型时搜索能力开箱即用。 */
async function resolveZhipuKey(): Promise<string | undefined> {
  if (config.webSearchApiKey?.trim()) return config.webSearchApiKey.trim();
  const providers = await prisma.provider.findMany({ where: { isActive: true } });
  const zhipu = providers.find(
    (provider) =>
      provider.apiKey &&
      /bigmodel\.cn|zhipu/i.test(`${provider.apiBase} ${provider.name}`),
  );
  return zhipu?.apiKey ?? undefined;
}

function guessEngineFromKey(apiKey: string): SearchEngineId {
  if (apiKey.startsWith("tvly-")) return "tavily";
  if (/^[0-9a-f]{32}$/i.test(apiKey)) return "brave";
  if (apiKey.startsWith("sk-")) return "bocha";
  if (apiKey.includes(".")) return "zhipu";
  return "brave";
}

interface EnginePlan {
  engine: SearchEngineId;
  apiKey?: string;
  /** auto 模式下免 key 引擎失败时的后备顺序。 */
  fallbacks: SearchEngineId[];
}

async function resolveEnginePlan(): Promise<EnginePlan> {
  const requested = config.webSearchEngine?.trim().toLowerCase();
  const envKey = config.webSearchApiKey?.trim();

  if (requested && requested !== "auto") {
    if (!SEARCH_ENGINES.has(requested)) {
      throw new Error(
        `未知的搜索引擎 "${requested}"，可选：${[...SEARCH_ENGINES].join(", ")} 或 auto`,
      );
    }
    const engine = requested as SearchEngineId;
    if (engine === "sogou" || engine === "duckduckgo") return { engine, fallbacks: [] };
    const apiKey = engine === "zhipu" ? await resolveZhipuKey() : envKey;
    if (!apiKey) {
      throw new Error(
        `搜索引擎 ${engine} 需要 API key：请在 .env 中配置 OPENHARNESS_WEBSEARCH_API_KEY` +
          (engine === "zhipu" ? "，或在设置里配置智谱模型供应商后自动复用其 key" : ""),
      );
    }
    return { engine, apiKey, fallbacks: ["sogou", "duckduckgo"] };
  }

  // auto：智谱 key（env 或模型供应商复用）→ env key 按前缀猜 → 免 key 抓取
  const zhipuKey = await resolveZhipuKey();
  if (zhipuKey) return { engine: "zhipu", apiKey: zhipuKey, fallbacks: ["sogou", "duckduckgo"] };
  if (envKey) {
    const engine = guessEngineFromKey(envKey);
    return { engine, apiKey: envKey, fallbacks: ["sogou", "duckduckgo"] };
  }
  return { engine: "sogou", fallbacks: ["duckduckgo"] };
}

async function runSearch(engine: SearchEngineId, query: string, apiKey?: string): Promise<SearchResult[]> {
  switch (engine) {
    case "zhipu":
      return zhipuSearch(query, apiKey!);
    case "bocha":
      return bochaSearch(query, apiKey!);
    case "tavily":
      return tavilySearch(query, apiKey!);
    case "brave":
      return braveSearch(query, apiKey!);
    case "sogou":
      return sogouSearch(query);
    case "duckduckgo":
      return duckduckgoSearch(query);
  }
}

// ---------------------------------------------------------------------------
// webFetch：网页正文读取
// ---------------------------------------------------------------------------

interface FetchedPage {
  title?: string;
  content: string;
}

async function zhipuRead(url: string, apiKey: string): Promise<FetchedPage | undefined> {
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/reader", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url, return_format: "markdown" }),
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!response.ok) return undefined;
  const payload = (await response.json()) as {
    reader_result?: { title?: string; content?: string };
    data?: { reader_result?: { title?: string; content?: string } };
  };
  const content = payload.reader_result?.content ?? payload.data?.reader_result?.content;
  return typeof content === "string" && content.trim() ? { title: payload.reader_result?.title, content } : undefined;
}

async function jinaRead(url: string): Promise<FetchedPage | undefined> {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/plain", "X-Return-Format": "markdown" },
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!response.ok) return undefined;
  const content = await response.text();
  if (!content.trim()) return undefined;
  const title = /^Title:\s*(.+)$/m.exec(content)?.[1];
  return { title, content: content.replace(/^Title:\s*.+\n/m, "") };
}

async function localRead(url: string): Promise<FetchedPage> {
  const response = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,text/plain,application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (contentType.includes("text/html") || /^\s*<(!doctype|html)/i.test(body)) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1];
    const main = body
      .replace(/<(script|style|noscript|svg|iframe|nav|header|footer)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");
    return { title: title ? stripTags(title) : undefined, content: stripTags(main) };
  }
  return { content: body };
}

// ---------------------------------------------------------------------------
// Provider 装配
// ---------------------------------------------------------------------------

const WEBSEARCH_DESCRIPTION = `Search the web for up-to-date information. Returns a list of results with title, url and snippet.

- The current month is ${currentMonthLabel()} — use this when the query is about recent events or time-sensitive information.
- Craft precise keyword queries (the user's language works well); split multi-part questions into separate searches.
- When a snippet is not enough to answer, call webFetch on the result's url to read the full page.
- After answering from search results, end the reply with a "Sources:" list of the URLs you used as markdown links.`;

const WEBFETCH_DESCRIPTION = `Fetch a web page and return its readable content as Markdown text.

- HTTP URLs are automatically upgraded to HTTPS; the page is only read, never interacted with.
- Use it after webSearch when a result's snippet is insufficient, or when the user gives you a URL directly.
- Very long pages are truncated; the beginning carries the main content in most cases.`;

export class WebSearchToolProvider implements ToolProvider {
  readonly id = "websearch";
  readonly label = "网页工具";

  listTools(): ToolDescriptor[] {
    return [
      {
        name: "webSearch",
        label: "Web search",
        description: "Search the web and return ranked results (title, url, snippet).",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
      {
        name: "webFetch",
        label: "Web fetch",
        description: "Fetch a web page and return its readable content as Markdown.",
        risk: "low",
        mutating: false,
        defaultPolicy: { enabled: true, requireApproval: false },
        providerId: this.id,
      },
    ];
  }

  createTools(run: RunContext): Record<string, RuntimeTool> {
    const webSearch: RuntimeTool = createTool({
      id: "webSearch",
      description: WEBSEARCH_DESCRIPTION,
      inputSchema: z.object({
        query: z.string().min(2).describe("The search query to use"),
      }),
      execute: async ({ query }) => {
        try {
          const plan = await resolveEnginePlan();
          const attempts: Array<{ engine: string; error: unknown }> = [];
          try {
            const results = (await runSearch(plan.engine, query, plan.apiKey)).slice(0, MAX_RESULTS);
            if (results.length === 0) throw new Error(`${plan.engine} returned no results`);
            return { engine: plan.engine, query, results };
          } catch (error) {
            attempts.push({ engine: plan.engine, error });
          }
          for (const fallback of plan.fallbacks) {
            try {
              const results = (await runSearch(fallback, query)).slice(0, MAX_RESULTS);
              if (results.length === 0) continue;
              return { engine: fallback, query, results };
            } catch (error) {
              attempts.push({ engine: fallback, error });
            }
          }
          const detail = attempts
            .map(({ engine, error }) => `${engine}: ${error instanceof Error ? error.message : String(error)}`)
            .join("; ");
          return { error: `网页搜索失败（${detail}）` };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    });

    const webFetch: RuntimeTool = createTool({
      id: "webFetch",
      description: WEBFETCH_DESCRIPTION,
      inputSchema: z.object({
        url: z.url().regex(/^https?:\/\//, "Only http(s) URLs are supported").describe("The URL to fetch"),
      }),
      execute: async ({ url }) => {
        const target = url.startsWith("http://") ? url.replace(/^http:/, "https:") : url;
        const attempts: Array<{ engine: string; error: unknown }> = [];
        const zhipuKey = await resolveZhipuKey();
        const chain: Array<{ engine: string; load: () => Promise<FetchedPage | undefined> }> = [];
        if (zhipuKey) {
          chain.push({ engine: "zhipu-reader", load: () => zhipuRead(target, zhipuKey) });
        }
        chain.push({ engine: "jina-reader", load: () => jinaRead(target) });
        chain.push({
          engine: "direct",
          load: async () => {
            const page = await localRead(target);
            if (!page.content.trim()) throw new Error("页面没有可读文本");
            return page;
          },
        });

        for (const { engine, load } of chain) {
          try {
            const page = await load();
            if (!page?.content.trim()) throw new Error("empty content");
            const header = page.title ? `# ${page.title}\n\n` : "";
            const full = `${header}${page.content}`;
            const truncated = full.length > WEBFETCH_CONTENT_LIMIT;
            return {
              engine,
              url: target,
              title: page.title,
              truncated,
              content: truncated
                ? `${full.slice(0, WEBFETCH_CONTENT_LIMIT)}\n\n[内容过长已截断，完整内容可再次分段获取]`
                : full,
            };
          } catch (error) {
            attempts.push({ engine, error });
          }
        }
        const detail = attempts
          .map(({ engine, error }) => `${engine}: ${error instanceof Error ? error.message : String(error)}`)
          .join("; ");
        return { error: `读取网页失败（${detail}）` };
      },
    });

    return { webSearch, webFetch };
  }
}
