import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
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
  /** Selecting a session under a project also switches the project context. */
  onSelect: (id: string, projectId?: string) => void;
  onNew: () => void;
  /** 在指定项目下新建对话（项目行右侧的 + 按钮）。 */
  onNewInProject: (projectId: string) => void;
  onDelete: (id: string) => void;
  onProjectsChanged: () => void;
  onOpenSettings: () => void;
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
      <SidebarGroup className="py-1">
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

/**
 * Single-line title with ellipsis; when the text overflows, hovering pauses a
 * beat and then scrolls it back and forth until the pointer leaves.
 */
function ScrollableTitle({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [scrollDistance, setScrollDistance] = useState<number>();

  const handleMouseEnter = () => {
    const element = ref.current;
    if (!element) return;
    const overflow = element.scrollWidth - element.clientWidth;
    setScrollDistance(overflow > 4 ? overflow : undefined);
  };

  const style =
    scrollDistance !== undefined
      ? ({
          "--scroll-distance": `${-scrollDistance}px`,
          animation: `session-title-scroll ${Math.max(2, scrollDistance / 40).toFixed(2)}s ease-in-out 0.35s infinite alternate`,
        } as CSSProperties)
      : undefined;

  return (
    <span className="min-w-0 flex-1 overflow-hidden">
      <span
        ref={ref}
        style={style}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setScrollDistance(undefined)}
        className="block truncate text-sm"
      >
        {text}
      </span>
    </span>
  );
}

/**
 * 会话项左侧的运行状态点（参考 PI-Desktop）：
 * - 后台运行中：橙色呼吸圆点
 * - 等待审批：紫色脉冲圆点
 * 空闲会话不显示任何点。
 */
function SessionStatusDot({ status }: { status?: string | null }) {
  if (status === "waiting_approval") {
    return <span className="oh-session-dot oh-session-dot--waiting" title="等待审批" />;
  }
  if (status === "running" || status === "queued") {
    return <span className="oh-session-dot oh-session-dot--running" title="后台运行中" />;
  }
  return null;
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
  onNewInProject,
  onDelete,
  onProjectsChanged,
  onOpenSettings,
}: AppSidebarProps) {
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  // Undefined = never toggled; falls back to "open when project is active".
  const [projectExpanded, setProjectExpanded] = useState<Record<string, boolean>>({});

  const projectSessions = useMemo(() => {
    const grouped = new Map<string, SessionSummary[]>();
    for (const project of projects) grouped.set(project.id, []);
    const recent: SessionSummary[] = [];
    for (const session of sessions) {
      if (session.projectId && grouped.has(session.projectId)) {
        grouped.get(session.projectId)!.push(session);
      } else if (!session.projectId) {
        recent.push(session);
      }
    }
    return { grouped, recent };
  }, [sessions, projects]);

  const renderSessionItem = (session: SessionSummary, projectId?: string) => (
    <SidebarMenuItem key={session.id}>
      <SidebarMenuButton
        isActive={session.id === sessionId}
        onClick={() => onSelect(session.id, projectId)}
      >
        <SessionStatusDot status={session.activeRunStatus} />
        <ScrollableTitle text={session.title} />
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
  );

  const sessionList = (items: SessionSummary[], projectId?: string) =>
    items.length === 0 ? (
      <p className="px-2 py-4 text-center text-xs text-muted-foreground">
        {loading ? "加载中..." : "暂无对话"}
      </p>
    ) : (
      <SidebarMenu>{items.map((session) => renderSessionItem(session, projectId))}</SidebarMenu>
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

        <SidebarContent className="gap-0">
          <CollapsibleGroup label="项目">
            <SidebarGroupContent>
              {projects.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">暂无项目</p>
              ) : (
                <SidebarMenu>
                  {projects.map((project) => {
                    const open = projectExpanded[project.id] ?? project.id === activeProjectId;
                    return (
                      <Collapsible
                        key={project.id}
                        open={open}
                        onOpenChange={(next) =>
                          setProjectExpanded((prev) => ({ ...prev, [project.id]: next }))
                        }
                      >
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton
                              isActive={project.id === activeProjectId}
                              title={project.rootPath}
                              onClick={() => onSelectProject(project.id)}
                            >
                              {open ? (
                                <FolderOpen className="text-muted-foreground" />
                              ) : (
                                <Folder className="text-muted-foreground" />
                              )}
                              <span>{project.name}</span>
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          <SidebarMenuAction
                            showOnHover
                            className="top-1/2! -translate-y-1/2 text-muted-foreground hover:text-sidebar-accent-foreground"
                            onClick={() => onNewInProject(project.id)}
                            title="新建项目对话"
                          >
                            <Plus />
                          </SidebarMenuAction>
                          <CollapsibleContent>
                            <div className="mt-1 ml-4 py-1">
                              {sessionList(projectSessions.grouped.get(project.id) ?? [], project.id)}
                            </div>
                          </CollapsibleContent>
                        </SidebarMenuItem>
                      </Collapsible>
                    );
                  })}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </CollapsibleGroup>

          <CollapsibleGroup label="最近">
            <SidebarGroupContent>{sessionList(projectSessions.recent)}</SidebarGroupContent>
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
