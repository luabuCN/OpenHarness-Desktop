import { LoaderCircleIcon, RefreshCwIcon, Undo2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listChanges,
  revertChanges,
  revertConversationChanges,
  type FileChangeInfo,
  type ProjectInfo,
} from "@/api";
import { DiffCard } from "@/components/ai-elements/diff-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CHANGE_KIND_LABEL: Record<string, string> = {
  create: "新建",
  edit: "修改",
  delete: "删除",
};

/** Per-path file changes recorded from edit tools across the project, with
 * one-click revert back to the pre-conversation snapshot. */
export function ChangesPanel({
  project,
  sessionId,
  busy,
}: {
  project?: ProjectInfo | null;
  sessionId?: string;
  busy?: boolean;
}) {
  const [changes, setChanges] = useState<FileChangeInfo[]>();
  const [totals, setTotals] = useState({ files: 0, additions: 0, deletions: 0 });
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [reverting, setReverting] = useState<string>();
  // Polling every 2.5s must not re-render the panel when nothing changed.
  const signatureRef = useRef("");

  const load = useCallback(() => {
    if (!project) return;
    listChanges({ projectId: project.id })
      .then((data) => {
        const signature = `${data.totals.files}:${data.totals.additions}:${data.totals.deletions}:${data.changes
          .map((change) => `${change.id}:${change.additions}:${change.deletions}`)
          .join(",")}`;
        if (signature === signatureRef.current) return;
        signatureRef.current = signature;
        setChanges(data.changes);
        setTotals(data.totals);
        setError(undefined);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "加载变更失败"));
  }, [project]);

  useEffect(() => {
    setChanges(undefined);
    setNotice(undefined);
    signatureRef.current = "";
    load();
  }, [load]);

  // Keep the list fresh while an agent run keeps editing files.
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(load, 2_500);
    return () => window.clearInterval(timer);
  }, [busy, load]);

  if (!project) {
    return <p className="py-10 text-center text-xs text-muted-foreground">选择项目后可查看对话产生的文件变更。</p>;
  }

  const handleRevert = async (change: FileChangeInfo) => {
    setReverting(change.id);
    try {
      const result = await revertChanges([change.id]);
      setNotice(formatRevertNotice(result));
      load();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "撤销失败");
    } finally {
      setReverting(undefined);
    }
  };

  const handleRevertAll = async () => {
    if (!sessionId) return;
    setReverting("__all__");
    try {
      const result = await revertConversationChanges(sessionId);
      setNotice(formatRevertNotice(result));
      load();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "撤销失败");
    } finally {
      setReverting(undefined);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0 text-xs text-muted-foreground">
          {changes === undefined ? (
            "正在加载变更…"
          ) : (
            <span className="flex items-center gap-2">
              <span>{totals.files} 个文件</span>
              {totals.additions > 0 ? (
                <span className="text-green-700 dark:text-green-400">+{totals.additions}</span>
              ) : null}
              {totals.deletions > 0 ? (
                <span className="text-red-700 dark:text-red-400">-{totals.deletions}</span>
              ) : null}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {sessionId && changes && changes.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={reverting !== undefined}
              onClick={() => void handleRevertAll()}
              title="把本会话修改过的文件恢复到会话开始前的内容"
            >
              {reverting === "__all__" ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <Undo2Icon className="size-3.5" />
              )}
              撤销本会话修改
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={load}
            title="刷新"
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {notice ? (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">{notice}</p>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {changes === undefined ? null : changes.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            还没有文件修改记录。对话中让 Agent 修改代码后，这里会列出变更。
          </p>
        ) : (
          changes.map((change) => (
            <div key={change.id} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge
                  variant={change.changeKind === "create" ? "default" : "secondary"}
                  className="shrink-0 text-[10px]"
                >
                  {CHANGE_KIND_LABEL[change.changeKind] ?? change.changeKind}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={change.path}>
                  {change.path}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground"
                  disabled={reverting !== undefined}
                  onClick={() => void handleRevert(change)}
                  title="恢复到本会话首次修改前的内容"
                >
                  {reverting === change.id ? (
                    <LoaderCircleIcon className="size-3 animate-spin" />
                  ) : (
                    <Undo2Icon className="size-3" />
                  )}
                  撤销
                </Button>
              </div>
              <DiffCard
                title={change.path}
                diff={change.unifiedDiff}
                additions={change.additions}
                deletions={change.deletions}
                defaultOpen={false}
                className={cn(changes.length > 1 && "mb-1")}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatRevertNotice(result: {
  results: Array<{ path: string; action: string }>;
  failures: Array<{ path: string; error: string }>;
}): string {
  const parts: string[] = [];
  if (result.results.length > 0) {
    const restored = result.results.filter((entry) => entry.action === "restored").length;
    const deleted = result.results.filter((entry) => entry.action === "deleted").length;
    const segments = [
      restored > 0 ? `已恢复 ${restored} 个文件` : null,
      deleted > 0 ? `已删除 ${deleted} 个新建文件` : null,
    ].filter(Boolean);
    if (segments.length > 0) parts.push(segments.join("，"));
  }
  for (const failure of result.failures) {
    parts.push(`${failure.path}：${failure.error}`);
  }
  return parts.length > 0 ? parts.join("；") : "没有可撤销的修改";
}
