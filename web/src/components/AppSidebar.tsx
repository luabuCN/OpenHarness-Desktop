import { useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
import type { ProjectInfo, SessionSummary } from "@/api";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ProjectForm } from "@/components/settings/ProjectForm";

export interface AppSidebarProps {
  sessions: SessionSummary[];
  sessionId: string;
  loading: boolean;
  error?: string;
  projects: ProjectInfo[];
  activeProjectId?: string;
  onSelectProject: (projectId?: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onProjectsChanged: () => void;
  onOpenSettings: () => void;
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const startOfDay = (target: Date) =>
    new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `昨天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function CollapsibleGroup({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="w-full cursor-pointer">
            <span className="min-w-0 truncate">{label}</span>
            <ChevronDown className="ml-auto transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>{children}</CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AppSidebar({
  sessions,
  sessionId,
  loading,
  error,
  projects,
  activeProjectId,
  onSelectProject,
  onSelect,
  onNew,
  onDelete,
  onProjectsChanged,
  onOpenSettings,
}: AppSidebarProps) {
  const [projectFormOpen, setProjectFormOpen] = useState(false);

  const activeProject = projects.find((project) => project.id === activeProjectId);

  const visibleSessions = useMemo(
    () =>
      sessions.filter((session) => (session.projectId ?? undefined) === activeProjectId),
    [sessions, activeProjectId],
  );

  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onNew}>
                <SquarePen className="text-muted-foreground" />
                <span>新对话</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setProjectFormOpen(true)}>
                <FolderPlus className="text-muted-foreground" />
                <span>新项目</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <CollapsibleGroup label="项目">
            <SidebarGroupContent>
              {projects.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">暂无项目</p>
              ) : (
                <SidebarMenu>
                  {projects.map((project) => (
                    <SidebarMenuItem key={project.id}>
                      <SidebarMenuButton
                        isActive={project.id === activeProjectId}
                        title={project.rootPath}
                        onClick={() =>
                          onSelectProject(
                            project.id === activeProjectId ? undefined : project.id,
                          )
                        }
                      >
                        <Folder className="text-muted-foreground" />
                        <span>{project.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </CollapsibleGroup>

          <CollapsibleGroup label={activeProject ? activeProject.name : "最近"}>
            <SidebarGroupContent>
              {visibleSessions.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  {loading ? "加载中..." : "暂无对话"}
                </p>
              ) : (
                <SidebarMenu>
                  {visibleSessions.map((session) => (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        isActive={session.id === sessionId}
                        onClick={() => onSelect(session.id)}
                        className="h-auto items-start py-1.5"
                      >
                        <span className="flex-1">
                          <span className="block truncate">{session.title}</span>
                          <small className="block truncate text-xs text-muted-foreground">
                            {formatSessionTime(session.updatedAt)}
                          </small>
                        </span>
                      </SidebarMenuButton>

                      <SidebarMenuAction
                        showOnHover
                        className="top-1/2! -translate-y-1/2 text-muted-foreground hover:text-destructive"
                        onClick={() => onDelete(session.id)}
                        title="删除对话"
                      >
                        <Trash2 />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </CollapsibleGroup>
        </SidebarContent>

        {error ? (
          <div className="border-t border-sidebar-border p-2 text-xs text-destructive">
            <span className="block truncate">{error}</span>
          </div>
        ) : null}

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onOpenSettings}>
                <Settings className="text-muted-foreground" />
                <span>设置</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <Dialog open={projectFormOpen} onOpenChange={setProjectFormOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>添加项目</DialogTitle>
          </DialogHeader>
          {projectFormOpen ? (
            <ProjectForm
              onSaved={(project) => {
                setProjectFormOpen(false);
                onProjectsChanged();
                onSelectProject(project.id);
              }}
              onCancel={() => setProjectFormOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
