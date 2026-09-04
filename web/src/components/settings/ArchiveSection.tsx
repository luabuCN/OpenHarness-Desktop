import { useCallback, useEffect, useState } from "react";
import {
  ArchiveRestore,
  Folder,
  Inbox,
  Loader2,
  MessageSquare,
  Trash2,
} from "lucide-react";

import {
  deleteProject,
  deleteSession,
  listArchivedSessions,
  listProjects,
  updateProject,
  updateSession,
  type ArchivedSessionSummary,
  type ProjectInfo,
} from "@/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ArchiveSectionProps {
  onChanged?: () => void;
}

/**
 * 设置页的归档分区（参考 PI-Desktop 的项目归档页）：归档的对话与项目
 * 收纳在这里，可恢复回侧栏或彻底删除。
 */
export function ArchiveSection({ onChanged }: ArchiveSectionProps) {
  const [sessions, setSessions] = useState<ArchivedSessionSummary[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState<ArchivedSessionSummary | null>(null);
  const [deletingProject, setDeletingProject] = useState<ProjectInfo | null>(null);

  const archivedProjects = projects.filter((project) => project.archivedAt);
  const projectById = (id?: string | null) =>
    projects.find((candidate) => candidate.id === id);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSessions, nextProjects] = await Promise.all([
        listArchivedSessions(),
        listProjects(),
      ]);
      setSessions(nextSessions);
      setProjects(nextProjects);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载归档失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function restoreSession(id: string) {
    try {
      await updateSession(id, { archived: false });
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复失败");
    }
  }

  async function removeSession() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await deleteSession(target.id);
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    }
  }

  async function restoreProject(id: string) {
    try {
      await updateProject(id, { archived: false });
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复项目失败");
    }
  }

  async function removeProject() {
    if (!deletingProject) return;
    const target = deletingProject;
    setDeletingProject(null);
    try {
      await deleteProject(target.id);
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除项目失败");
    }
  }

  const empty = sessions.length === 0 && archivedProjects.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-4">
        <div className="text-base font-semibold">归档</div>
        <span className="text-xs text-muted-foreground">
          {empty || loading ? null : `${sessions.length} 个对话 · ${archivedProjects.length} 个项目`}
        </span>
      </div>
      {error ? <p className="px-4 text-xs text-destructive">{error}</p> : null}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            加载中...
          </p>
        ) : empty ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Inbox size={28} className="text-muted-foreground" />
            <p className="text-sm font-medium">暂无归档内容</p>
            <p className="max-w-64 text-xs text-muted-foreground">
              在侧栏对话或项目的「···」菜单中选择“归档”，对应内容会收纳到这里，不再占据侧栏。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-4 pb-4">
            {sessions.length > 0 ? (
              <section>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">对话</h3>
                {sessions.map((session) => {
                  const project = projectById(session.projectId);
                  return (
                    <Item key={session.id} size="sm" className="justify-between gap-2">
                      <ItemContent>
                        <ItemTitle className="max-w-full">
                          <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
                          <span className="truncate">{session.title}</span>
                        </ItemTitle>
                        <ItemDescription className="line-clamp-1">
                          {project ? `${project.name} · ` : ""}
                          归档于 {new Date(session.archivedAt).toLocaleString()}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="恢复到侧栏"
                          onClick={() => void restoreSession(session.id)}
                        >
                          <ArchiveRestore size={14} />
                          恢复
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          title="彻底删除"
                          onClick={() => setDeleting(session)}
                        >
                          <Trash2 size={14} />
                          删除
                        </Button>
                      </ItemActions>
                    </Item>
                  );
                })}
              </section>
            ) : null}

            {archivedProjects.length > 0 ? (
              <section>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">项目</h3>
                {archivedProjects.map((project) => (
                  <Item key={project.id} size="sm" className="justify-between gap-2">
                    <ItemContent>
                      <ItemTitle className="max-w-full">
                        <Folder size={14} className="shrink-0 text-muted-foreground" />
                        <span className="truncate">{project.name}</span>
                      </ItemTitle>
                      <ItemDescription className="line-clamp-1">
                        <span className="truncate">{project.rootPath}</span>
                        {" · 归档于 "}
                        {new Date(project.archivedAt!).toLocaleDateString()}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="恢复到侧栏"
                        onClick={() => void restoreProject(project.id)}
                      >
                        <ArchiveRestore size={14} />
                        恢复
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        title="彻底删除"
                        onClick={() => setDeletingProject(project)}
                      >
                        <Trash2 size={14} />
                        删除
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </section>
            ) : null}
          </div>
        )}
      </ScrollArea>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除归档对话</AlertDialogTitle>
            <AlertDialogDescription>
              确定彻底删除“{deleting?.title}”吗？对话的全部消息与运行记录将一并删除，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void removeSession()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deletingProject !== null}
        onOpenChange={(open) => !open && setDeletingProject(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除归档项目</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除项目“{deletingProject?.name}”吗？项目下的对话会保留并移到侧栏“最近”，项目的默认配置将被移除，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void removeProject()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
