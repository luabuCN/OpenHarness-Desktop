import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  gitCommit,
  gitDiffFile,
  gitLog,
  gitPull,
  gitPush,
  gitStatus,
  type GitCommitInfo,
  type GitStatusInfo,
  type ProjectInfo,
} from "@/api";
import { DiffBlock } from "@/components/ai-elements/diff-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FileState = "已暂存" | "已修改" | "未跟踪" | "冲突";

interface GitFileEntry {
  path: string;
  state: FileState;
}

function entriesFromStatus(status: GitStatusInfo): GitFileEntry[] {
  const seen = new Map<string, GitFileEntry>();
  const push = (path: string, state: FileState) => {
    if (!seen.has(path)) seen.set(path, { path, state });
  };
  for (const path of status.conflicted ?? []) push(path, "冲突");
  for (const path of status.staged ?? []) push(path, "已暂存");
  for (const path of status.changed ?? []) push(path, "已修改");
  for (const path of status.untracked ?? []) push(path, "未跟踪");
  return [...seen.values()];
}

const STATE_BADGE: Record<FileState, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  已暂存: { label: "暂存", variant: "default" },
  已修改: { label: "修改", variant: "secondary" },
  未跟踪: { label: "新文件", variant: "outline" },
  冲突: { label: "冲突", variant: "destructive" },
};

/** Manual git panel: branch status, per-file diffs, and commit/pull/push for
 * the selected project. Agent-driven git calls appear in chat tool cards. */
export function GitPanel({ project }: { project?: ProjectInfo | null }) {
  const [status, setStatus] = useState<GitStatusInfo>();
  const [entries, setEntries] = useState<GitFileEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<string>();
  const [actionBusy, setActionBusy] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [diffText, setDiffText] = useState<string>();
  const [commits, setCommits] = useState<GitCommitInfo[]>();

  const load = useCallback(() => {
    if (!project) return;
    gitStatus(project.id)
      .then((next) => {
        setStatus(next);
        const nextEntries = next.available ? entriesFromStatus(next) : [];
        setEntries(nextEntries);
        setSelected(new Set(nextEntries.map((entry) => entry.path)));
      })
      .catch((cause) => setAction(cause instanceof Error ? cause.message : "加载 git 状态失败"));
    gitLog(project.id, 5)
      .then((data) => setCommits(data.commits))
      .catch(() => setCommits(undefined));
  }, [project]);

  useEffect(() => {
    setStatus(undefined);
    setEntries([]);
    setSelected(new Set());
    setExpanded(undefined);
    setDiffText(undefined);
    setAction(undefined);
    load();
  }, [load]);

  if (!project) {
    return <p className="py-10 text-center text-xs text-muted-foreground">选择项目后可使用 Git 面板。</p>;
  }
  if (status === undefined) {
    return <p className="py-10 text-center text-xs text-muted-foreground">正在读取 git 状态…</p>;
  }
  if (!status.available) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">{status.reason ?? "git 不可用"}</p>
    );
  }

  const toggle = (path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const viewDiff = async (entry: GitFileEntry) => {
    if (expanded === entry.path) {
      setExpanded(undefined);
      return;
    }
    setExpanded(entry.path);
    setDiffText(undefined);
    if (entry.state === "未跟踪") return;
    try {
      const data = await gitDiffFile(project.id, entry.path);
      setDiffText(data.diff);
    } catch (cause) {
      setDiffText(cause instanceof Error ? cause.message : "读取差异失败");
    }
  };

  const runAction = async (name: string, task: () => Promise<string>) => {
    setActionBusy(name);
    try {
      setAction(await task());
      load();
    } catch (cause) {
      setAction(cause instanceof Error ? cause.message : `${name} 失败`);
    } finally {
      setActionBusy(undefined);
    }
  };

  const handleCommit = () =>
    runAction("提交", async () => {
      const files = entries.filter((entry) => selected.has(entry.path)).map((entry) => entry.path);
      const result = await gitCommit(project.id, files, message.trim());
      setMessage("");
      return `已提交 ${result.commit.slice(0, 7)}（${files.length} 个文件）`;
    });

  const handlePull = () =>
    runAction("拉取", async () => {
      const result = await gitPull(project.id);
      return `已拉取：${result.files.length} 个文件变化`;
    });

  const handlePush = () =>
    runAction("推送", async () => {
      const result = await gitPush(project.id);
      return result.pushed ? `已推送分支 ${result.branch}` : "没有需要推送的内容";
    });

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{status.branch ?? "（无分支）"}</span>
          {(status.behind ?? 0) > 0 ? (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
              <ArrowDownIcon className="size-3" />
              {status.behind}
            </span>
          ) : null}
          {(status.ahead ?? 0) > 0 ? (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
              <ArrowUpIcon className="size-3" />
              {status.ahead}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={actionBusy !== undefined}
            onClick={() => void handlePull()}
          >
            {actionBusy === "拉取" ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <ArrowDownIcon className="size-3.5" />
            )}
            拉取
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={actionBusy !== undefined}
            onClick={() => void handlePush()}
          >
            {actionBusy === "推送" ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <ArrowUpIcon className="size-3.5" />
            )}
            推送
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={load} title="刷新">
            <RefreshCwIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {action ? (
        <p className="shrink-0 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">{action}</p>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">工作区干净，没有待提交的更改。</p>
        ) : (
          <ul className="space-y-1">
            {entries.map((entry) => (
              <li key={entry.path} className="rounded-md border">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected.has(entry.path)}
                    onClick={() => toggle(entry.path)}
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border",
                      selected.has(entry.path)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input hover:bg-muted",
                    )}
                  >
                    {selected.has(entry.path) ? <CheckIcon className="size-3" /> : null}
                  </button>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => void viewDiff(entry)}
                  >
                    <Badge
                      variant={STATE_BADGE[entry.state].variant}
                      className="shrink-0 px-1.5 py-0 text-[10px]"
                    >
                      {STATE_BADGE[entry.state].label}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.path}>
                      {entry.path}
                    </span>
                  </button>
                </div>
                {expanded === entry.path ? (
                  <div className="border-t px-1 py-1">
                    {entry.state === "未跟踪" ? (
                      <p className="px-1 py-1.5 text-xs text-muted-foreground">
                        未跟踪的新文件，提交时将整体加入。
                      </p>
                    ) : diffText === undefined ? (
                      <p className="px-1 py-1.5 text-xs text-muted-foreground">正在读取差异…</p>
                    ) : (
                      <DiffBlock diff={diffText} className="max-h-72 border-0" />
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-md border p-2">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="提交信息…"
            rows={2}
            className="w-full resize-none rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            size="sm"
            className="h-7 w-full gap-1 text-xs"
            disabled={
              actionBusy !== undefined || message.trim().length === 0 || selected.size === 0
            }
            onClick={() => void handleCommit()}
          >
            {actionBusy === "提交" ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <CheckIcon className="size-3.5" />
            )}
            提交（已选 {selected.size} 个文件）
          </Button>
        </div>

        {commits && commits.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">最近提交</p>
            <ul className="space-y-1">
              {commits.map((commit) => (
                <li key={commit.hash} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 font-mono text-muted-foreground">{commit.shortHash}</span>
                  <span className="min-w-0 flex-1 truncate" title={commit.message}>
                    {commit.message.split("\n")[0]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
