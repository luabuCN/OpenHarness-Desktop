import { ExternalLinkIcon, FileTextIcon, GlobeIcon } from "lucide-react";
import type { ToolPart } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

/** webSearch / webFetch 的专属结果渲染（参考 aime-chat 的 Tool Result 面板）：
 * 搜索结果是“标题 + 来源 + 摘要”卡片列表；webFetch 是可滚动的正文块。
 * 标题点击默认送进内置浏览器面板：聊天流里渲染成真实 <a>，由 ChatPane
 * 的链接捕获层统一接管；右侧面板不在捕获层内，通过 onOpenLink 显式传入。
 * 原始 JSON 兜底仍由 ToolOutput 处理。 */

export interface WebSearchOutput {
  engine?: string;
  query?: string;
  results?: Array<{ title?: string; url?: string; snippet?: string }>;
}

export interface WebFetchOutput {
  engine?: string;
  url?: string;
  title?: string;
  content?: string;
  truncated?: boolean;
}

function readOutput(part: ToolPart): Record<string, unknown> | undefined {
  if (part.state !== "output-available") return undefined;
  if (!("output" in part) || part.output === null || typeof part.output !== "object") return undefined;
  const record = part.output as Record<string, unknown>;
  return typeof record.error === "string" ? undefined : record;
}

export function extractWebSearchOutput(toolName: string, part: ToolPart): WebSearchOutput | null {
  if (toolName !== "webSearch") return null;
  const output = readOutput(part);
  if (!output || !Array.isArray(output.results)) return null;
  return output as unknown as WebSearchOutput;
}

export function extractWebFetchOutput(toolName: string, part: ToolPart): WebFetchOutput | null {
  if (toolName !== "webFetch") return null;
  const output = readOutput(part);
  if (!output || typeof output.content !== "string") return null;
  return output as unknown as WebFetchOutput;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 搜索结果卡片列表：序号 + 标题（点击在内置浏览器面板打开）+ 来源域名 + 摘要。 */
export function WebSearchResults({
  output,
  onOpenLink,
  className,
}: {
  output: WebSearchOutput;
  /** 缺省（聊天流）时标题渲染为真实 <a>，由外层捕获层接管跳转。 */
  onOpenLink?: (url: string) => void;
  className?: string;
}) {
  const results = output.results ?? [];
  const titleClass =
    "flex w-full items-start gap-1 text-left text-sm font-medium text-primary hover:underline";
  return (
    <div className={cn("overflow-hidden rounded-md border", className)}>
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <GlobeIcon className="size-3.5 shrink-0" />
        <span className="shrink-0">
          搜索结果 · {results.length} 条
          {output.engine ? ` · ${output.engine}` : ""}
        </span>
        {output.query ? (
          <span className="min-w-0 flex-1 truncate font-mono">{output.query}</span>
        ) : null}
      </div>
      <ol className="divide-y">
        {results.map((result, index) => {
          const url = result.url ?? "";
          return (
            <li key={`${url}-${index}`} className="px-3 py-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {index + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  {url ? (
                    onOpenLink ? (
                      <button
                        type="button"
                        onClick={() => onOpenLink(url)}
                        title={url}
                        className={titleClass}
                      >
                        <span className="min-w-0 break-words">{result.title || url}</span>
                        <ExternalLinkIcon className="mt-0.5 size-3 shrink-0 opacity-60" />
                      </button>
                    ) : (
                      <a href={url} target="_blank" rel="noopener noreferrer" title={url} className={titleClass}>
                        <span className="min-w-0 break-words">{result.title || url}</span>
                        <ExternalLinkIcon className="mt-0.5 size-3 shrink-0 opacity-60" />
                      </a>
                    )
                  ) : (
                    <p className="break-words text-sm font-medium">{result.title || "(无标题)"}</p>
                  )}
                  {url ? (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hostOf(url)}</p>
                  ) : null}
                  {result.snippet ? (
                    <p className="mt-1 line-clamp-3 break-words text-xs text-muted-foreground">
                      {result.snippet}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** webFetch 正文：标题 + 来源 + 可滚动文本（超长截断提示）。 */
export function WebFetchContent({
  output,
  className,
}: {
  output: WebFetchOutput;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-md border", className)}>
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <FileTextIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono">
          {output.title || output.url?.replace(/^https?:\/\//, "") || "网页内容"}
        </span>
        <span className="shrink-0">{output.engine ?? ""}</span>
      </div>
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed">
        {output.content}
      </pre>
      {output.truncated ? (
        <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          内容过长已截断（可在右侧工具结果面板查看完整输出）
        </p>
      ) : null}
    </div>
  );
}
