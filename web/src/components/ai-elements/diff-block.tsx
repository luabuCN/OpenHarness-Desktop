import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

/** One parsed line of a unified diff. */
interface DiffLine {
  kind: "add" | "del" | "context" | "hunk" | "meta";
  text: string;
  oldNo?: number;
  newNo?: number;
}

const HUNK_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;

  for (const line of diff.split("\n")) {
    // File headers must be tested before +/- content lines: "+++ b/x" starts with "+".
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("diff --git") || line.startsWith("index ")) {
      lines.push({ kind: "meta", text: line });
      continue;
    }
    const hunk = HUNK_PATTERN.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      lines.push({ kind: "hunk", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
    } else if (line.startsWith("-")) {
      lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
    } else if (line.startsWith("\\")) {
      lines.push({ kind: "meta", text: line });
    } else {
      lines.push({ kind: "context", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return lines;
}

export interface DiffBlockProps {
  diff: string;
  className?: string;
  /** Wrap long lines instead of forcing horizontal scroll. */
  wrap?: boolean;
}

/** Read-only unified diff view (GitHub style, single column). */
export function DiffBlock({ diff, className, wrap = false }: DiffBlockProps) {
  const lines = useMemo(() => parseUnifiedDiff(diff), [diff]);

  return (
    <div
      className={cn(
        "overflow-auto rounded-md border bg-muted/30 font-mono text-xs leading-5",
        wrap ? "overflow-x-hidden" : "",
        className,
      )}
    >
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            "flex min-w-max items-start gap-2 px-2",
            wrap && "min-w-0 whitespace-pre-wrap break-all",
            !wrap && "whitespace-pre",
            line.kind === "add" && "bg-green-500/15",
            line.kind === "del" && "bg-red-500/15",
            line.kind === "hunk" && "bg-muted text-muted-foreground",
            line.kind === "meta" && "text-muted-foreground/70",
          )}
        >
          <span className="w-9 shrink-0 select-none text-right tabular-nums text-muted-foreground/60">
            {line.oldNo ?? ""}
          </span>
          <span className="w-9 shrink-0 select-none text-right tabular-nums text-muted-foreground/60">
            {line.newNo ?? ""}
          </span>
          <span
            className={cn(
              "w-3 shrink-0 select-none",
              line.kind === "add" && "text-green-700 dark:text-green-400",
              line.kind === "del" && "text-red-700 dark:text-red-400",
            )}
          >
            {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
          </span>
          <span
            className={cn(
              line.kind === "add" && "text-green-800 dark:text-green-300",
              line.kind === "del" && "text-red-800 dark:text-red-300",
              line.kind === "hunk" && "text-muted-foreground",
              line.kind === "meta" && "text-muted-foreground/70",
            )}
          >
            {line.text || " "}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Collapsible diff with the +/- summary header used in chat and panels. */
export function DiffCard({
  title,
  diff,
  additions,
  deletions,
  defaultOpen = true,
  className,
}: {
  title: string;
  diff: string | null;
  additions?: number;
  deletions?: number;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("overflow-hidden rounded-md border", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 bg-muted/50 px-2.5 py-1.5 text-left hover:bg-muted"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={title}>
          {title}
        </span>
        {typeof additions === "number" && additions > 0 ? (
          <span className="shrink-0 text-xs text-green-700 dark:text-green-400">+{additions}</span>
        ) : null}
        {typeof deletions === "number" && deletions > 0 ? (
          <span className="shrink-0 text-xs text-red-700 dark:text-red-400">-{deletions}</span>
        ) : null}
        <span className="shrink-0 text-muted-foreground">{open ? "收起" : "展开"}</span>
      </button>
      {open ? (
        diff ? (
          <DiffBlock diff={diff} className="max-h-96 rounded-none border-0" />
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            二进制文件或内容过大，无文本差异可显示。
          </p>
        )
      ) : null}
    </div>
  );
}
