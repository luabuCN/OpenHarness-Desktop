import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  apiFetch,
  API_URL,
  isReasoningEffort,
  listConversationRuns,
  listConversationTasks,
  listAgents,
  listProjects,
  listProviders,
  decideApproval,
  isPermissionMode,
  type ApprovalAction,
  type ModelSelection,
  type PermissionMode,
  type ProjectInfo,
  type ProviderInfo,
  type ReasoningEffort,
  type RunInfo,
  type SessionSummary,
  type AgentTaskInfo,
  type AgentInfo,
} from "./api";
import type { ChatUIMessage } from "./lib/chat-utils";
import { ChatPane, type TurnOutcomeNote } from "./components/ChatPane";
import { defaultModelSelection } from "./components/ModelSelector";
import { RightPanel, type RightTab } from "./components/RightPanel";
import { AppSidebar } from "./components/AppSidebar";
import { SettingsPage } from "./components/settings/SettingsPage";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { lastAssistantHasText } from "./lib/chat-utils";

const SESSION_KEY = "openharness.sessionId";
const THINKING_MODE_KEY = "openharness.thinkingMode";
const REASONING_EFFORT_KEY = "openharness.reasoningEffort";

/** 推理等级持久化：新键优先；旧 deep 设置迁移为 medium。 */
function loadReasoningEffort(): ReasoningEffort {
  const storedEffort = localStorage.getItem(REASONING_EFFORT_KEY);
  if (isReasoningEffort(storedEffort)) return storedEffort;
  if (localStorage.getItem(THINKING_MODE_KEY) === "deep") return "medium";
  return "off";
}
const PERMISSION_MODE_KEY = "openharness.permissionMode";
const AGENT_KEY = "openharness.agentId";
const PROJECT_KEY = "openharness.projectId";
// 标签栏（文件/任务/变更/Git/工具结果/用量）的最小内容宽度实测约 443px，
// 最小宽度取 450 保证六个标签全部可见、无需横向滚动。
const PANEL_WIDTH_MIN = 450;
const PANEL_WIDTH_DEFAULT = 460;

/** Stable identity across renders so memoized RightPanel skips work on tabs
 * that do not read the transcript (files/tasks/changes/git). */
const EMPTY_MESSAGES: ChatUIMessage[] = [];

function createSessionId() {
  return crypto.randomUUID();
}

interface SessionViewProps {
  sessionId: string;
  title: string;
  providers: ProviderInfo[];
  requestSelection: ModelSelection | null;
  displaySelection: ModelSelection | null;
  onSelectionChange: (selection: ModelSelection) => void;
  reasoningEffort: ReasoningEffort;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  agentId?: string;
  onAgentChange: (agentId: string) => void;
  projectId?: string;
  onProjectChange: (projectId?: string) => void;
  projects: ProjectInfo[];
  onProjectCreated: () => void;
  initialMessages: ChatUIMessage[];
  onFinished: () => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
}

function SessionView({
  sessionId,
  title,
  providers,
  requestSelection,
  displaySelection,
  onSelectionChange,
  reasoningEffort,
  permissionMode,
  onPermissionModeChange,
  agentId,
  onAgentChange,
  projectId,
  onProjectChange,
  projects,
  onProjectCreated,
  initialMessages,
  onFinished,
  onReasoningEffortChange,
  panelOpen,
  onPanelOpenChange,
}: SessionViewProps) {
  const [tab, setTab] = useState<RightTab>("files");
  const [selectedToolId, setSelectedToolId] = useState<string>();
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH_DEFAULT);
  const reasoningEffortRef = useRef(reasoningEffort);
  const permissionModeRef = useRef(permissionMode);
  const agentIdRef = useRef(agentId);
  const projectIdRef = useRef(projectId);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [tasks, setTasks] = useState<AgentTaskInfo[]>([]);
  const runsSignatureRef = useRef("");

  useEffect(() => {
    reasoningEffortRef.current = reasoningEffort;
  }, [reasoningEffort]);

  useEffect(() => {
    permissionModeRef.current = permissionMode;
  }, [permissionMode]);

  useEffect(() => {
    agentIdRef.current = agentId;
  }, [agentId]);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // Poll results keep their object identity only when the server state is
  // unchanged; skipping identical responses stops poll-driven re-renders of
  // the whole chat tree during long runs.
  const tasksSignatureRef = useRef("");
  const refreshTasks = useCallback(() => {
    void listConversationTasks(sessionId)
      .then((next) => {
        const signature = next
          .map((task) => `${task.id}:${task.status}:${task.activeForm ?? ""}`)
          .join("|");
        if (signature === tasksSignatureRef.current) return;
        tasksSignatureRef.current = signature;
        setTasks(next);
      })
      .catch(() => undefined);
  }, [sessionId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: `${API_URL}/api/chat`,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            id: sessionId,
            messages,
            reasoningEffort: reasoningEffortRef.current,
            thinkingMode: reasoningEffortRef.current === "off" ? "fast" : "deep",
            permissionMode: isPermissionMode(body?.permissionMode)
              ? body.permissionMode
              : permissionModeRef.current,
            agentId:
              typeof body?.agentId === "string" && body.agentId
                ? body.agentId
                : agentIdRef.current,
            projectId:
              typeof body?.projectId === "string" && body.projectId
                ? body.projectId
                : projectIdRef.current,
            ...(requestSelection ? { model: requestSelection } : {}),
          },
        }),
      }),
    [sessionId, projectId, requestSelection],
  );

  const chat: UseChatHelpers<ChatUIMessage> = useChat<ChatUIMessage>({
    id: sessionId,
    messages: initialMessages,
    transport,
    // Coalesce stream chunks into ~20 renders/sec. Without this every token
    // delta re-renders the whole streaming message (the server accumulates an
    // entire agent run into one message), which froze long answers.
    experimental_throttle: 50,
    onFinish: async (event) => {
      void event;
      onFinished();
    },
  });

  const setChatMessages = chat.setMessages;
  useEffect(() => {
    setChatMessages(initialMessages);
  }, [initialMessages, setChatMessages]);

  const busy = chat.status === "submitted" || chat.status === "streaming";

  useEffect(() => {
    if (!busy) {
      setRuns([]);
      runsSignatureRef.current = "";
      return;
    }

    let cancelled = false;
    const loadRuns = () => {
      void listConversationRuns(sessionId)
        .then((next) => {
          if (cancelled) return;
          const signature = next
            .map(
              (run) =>
                `${run.id}:${run.status}:${run.approvals.filter((approval) => approval.status === "pending").length}`,
            )
            .join("|");
          if (signature === runsSignatureRef.current) return;
          runsSignatureRef.current = signature;
          setRuns(next);
        })
        .catch(() => undefined);
    };

    loadRuns();
    const timer = window.setInterval(loadRuns, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busy, sessionId]);

  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  useEffect(() => {
    if (!busy) {
      const timer = window.setTimeout(refreshTasks, 500);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setInterval(refreshTasks, 1_500);
    return () => window.clearInterval(timer);
  }, [busy, refreshTasks]);

  const pendingApprovals = runs.flatMap((run) =>
    run.approvals
      .filter((approval) => approval.status === "pending")
      .map((approval) => ({ run, approval })),
  );

  // 模型目录里的上下文窗口大小，供用量页计算上下文占用。
  const contextWindow = useMemo(() => {
    if (!displaySelection) return undefined;
    const provider = providers.find(
      (candidate) => candidate.id === displaySelection.providerId,
    );
    const model = provider?.models.find(
      (candidate) => candidate.id === displaySelection.modelId,
    );
    return model?.limit?.context;
  }, [providers, displaySelection]);

  // 最近的回合异常结束（失败/中止）且没有文字总结时，在对话流末尾补一条提示；
  // 运行期间与正常回合不显示。刷新页面导致的中断在服务端记为 aborted，这里同样覆盖。
  const [latestRun, setLatestRun] = useState<RunInfo | null>(null);
  const refreshLatestRun = useCallback(() => {
    void listConversationRuns(sessionId)
      .then((next) => setLatestRun(next[0] ?? null))
      .catch(() => undefined);
  }, [sessionId]);

  useEffect(() => {
    refreshLatestRun();
  }, [refreshLatestRun, initialMessages]);

  useEffect(() => {
    if (!busy) refreshLatestRun();
  }, [busy, refreshLatestRun]);

  const turnNote = useMemo<TurnOutcomeNote | undefined>(() => {
    if (busy || !latestRun) return undefined;
    if (latestRun.status !== "failed" && latestRun.status !== "aborted") return undefined;
    if (lastAssistantHasText(chat.messages)) return undefined;
    return latestRun.status === "failed"
      ? {
          kind: "failed",
          message: `上次回合失败${latestRun.error ? `：${latestRun.error}` : "，未生成文字总结"}`,
        }
      : { kind: "aborted", message: "上次回合已被中止，未生成文字总结" };
  }, [busy, latestRun, chat.messages]);

  const handleApprovalDecision = useCallback(
    async (runId: string, approvalId: string, action: ApprovalAction) => {
      await decideApproval(runId, approvalId, action);
      setRuns((current) =>
        current.map((run) =>
          run.id !== runId
            ? run
            : {
                ...run,
                approvals: run.approvals.map((approval) => {
                  if (approval.id !== approvalId) return approval;

                  return {
                    ...approval,
                    status: action === "reject" ? "rejected" : "approved",
                  };
                }),
              },
        ),
      );
    },
    [],
  );

  const handleToolSelect = useCallback((id: string) => {
    setSelectedToolId(id);
    setTab("tools");
  }, []);

  const handleTogglePanel = useCallback(() => {
    onPanelOpenChange(!panelOpen);
  }, [onPanelOpenChange, panelOpen]);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = panelWidth;

      const handleMove = (moveEvent: MouseEvent) => {
        const maxWidth = Math.max(
          PANEL_WIDTH_MIN,
          Math.floor(window.innerWidth * 0.6),
        );
        const next = Math.min(
          Math.max(startWidth + (startX - moveEvent.clientX), PANEL_WIDTH_MIN),
          maxWidth,
        );
        setPanelWidth(next);
      };
      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [panelWidth],
  );

  return (
    <>
      <ChatPane
        chat={chat}
        title={title}
        providers={providers}
        displaySelection={displaySelection}
        onSelectionChange={onSelectionChange}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
        permissionMode={permissionMode}
        onPermissionModeChange={onPermissionModeChange}
        agentId={agentId}
        onAgentChange={onAgentChange}
        selectedToolId={selectedToolId}
        onToolSelect={handleToolSelect}
        panelOpen={panelOpen}
        onTogglePanel={handleTogglePanel}
        projects={projects}
        projectId={projectId}
        onProjectChange={onProjectChange}
        onProjectCreated={onProjectCreated}
        pendingApprovals={pendingApprovals}
        onApprovalDecision={(runId, approvalId, action) =>
          void handleApprovalDecision(runId, approvalId, action)
        }
        turnNote={turnNote}
      />
      {panelOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={handleResizeStart}
          className="group relative hidden w-1 shrink-0 cursor-col-resize lg:block"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/60 group-active:bg-primary" />
        </div>
      ) : null}
      {panelOpen ? (
        <RightPanel
          messages={tab === "tools" || tab === "usage" ? chat.messages : EMPTY_MESSAGES}
          tasks={tasks}
          tab={tab}
          onTabChange={setTab}
          selectedToolId={selectedToolId}
          onToolSelect={setSelectedToolId}
          width={panelWidth}
          project={projects.find((candidate) => candidate.id === projectId)}
          sessionId={sessionId}
          busy={busy}
          contextWindow={contextWindow}
        />
      ) : null}
    </>
  );
}

export function App() {
  const [sessionId, setSessionId] = useState(
    () => localStorage.getItem(SESSION_KEY) ?? createSessionId(),
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatUIMessage[]>([]);
  const [error, setError] = useState<string>();
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    loadReasoningEffort,
  );
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    const stored = localStorage.getItem(PERMISSION_MODE_KEY);
    return isPermissionMode(stored) ? stored : "confirm";
  });
  const [agentId, setAgentId] = useState<string | undefined>(
    () => localStorage.getItem(AGENT_KEY) ?? undefined,
  );
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [panelOpen, setPanelOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(
    () => localStorage.getItem(PROJECT_KEY) ?? undefined,
  );

  const refreshProviders = useCallback(() => {
    void listProviders()
      .then(setProviders)
      .catch(() => undefined);
  }, []);

  const isValidSelection = useCallback(
    (selection: ModelSelection | null | undefined): selection is ModelSelection =>
      !!selection &&
      providers.some(
        (provider) =>
          provider.isActive &&
          provider.id === selection.providerId &&
          provider.models.some((model) => model.enabled && model.id === selection.modelId),
      ),
    [providers],
  );

  const resolveConfiguredSelection = useCallback(
    (providerId?: string | null, modelId?: string | null): ModelSelection | null => {
      if (providerId && modelId) {
        const selection = { providerId, modelId };
        return isValidSelection(selection) ? selection : null;
      }
      if (!modelId) return null;
      const provider = providers.find(
        (entry) =>
          entry.isActive &&
          entry.models.some((model) => model.enabled && model.id === modelId),
      );
      return provider ? { providerId: provider.id, modelId } : null;
    },
    [isValidSelection, providers],
  );

  const refreshSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const data = await apiFetch<{ sessions: SessionSummary[] }>("/api/sessions");
      setSessions(data.sessions);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法连接本地服务");
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  const refreshAgents = useCallback(() => {
    void listAgents()
      .then(setAgents)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  const refreshProjects = useCallback(() => {
    void listProjects()
      .then(setProjects)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    localStorage.setItem(SESSION_KEY, sessionId);
  }, [sessionId]);

  useEffect(() => {
    localStorage.setItem(REASONING_EFFORT_KEY, reasoningEffort);
    // 旧字段同步写一份，回滚到旧版本前端时设置不丢。
    localStorage.setItem(THINKING_MODE_KEY, reasoningEffort === "off" ? "fast" : "deep");
  }, [reasoningEffort]);

  useEffect(() => {
    localStorage.setItem(PERMISSION_MODE_KEY, permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    if (agentId) {
      localStorage.setItem(AGENT_KEY, agentId);
    } else {
      localStorage.removeItem(AGENT_KEY);
    }
  }, [agentId]);

  useEffect(() => {
    if (projectId) localStorage.setItem(PROJECT_KEY, projectId);
    else localStorage.removeItem(PROJECT_KEY);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    apiFetch<{ messages: ChatUIMessage[] }>(`/api/sessions/${sessionId}`)
      .then((data) => {
        if (!cancelled) setMessages(data.messages);
      })
      .catch(() => setMessages([]));
    void refreshSessions();

    return () => {
      cancelled = true;
    };
  }, [refreshSessions, sessionId]);

  const initialMessages = useMemo(() => messages, [messages]);
  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const displaySelection = useMemo(() => {
    if (isValidSelection(modelSelection)) return modelSelection;
    return (
      resolveConfiguredSelection(
        selectedProject?.defaultProviderId,
        selectedProject?.defaultModelId,
      ) ??
      resolveConfiguredSelection(
        selectedAgent?.defaultProviderId,
        selectedAgent?.defaultModelId,
      ) ??
      defaultModelSelection(providers)
    );
  }, [
    isValidSelection,
    modelSelection,
    providers,
    resolveConfiguredSelection,
    selectedAgent,
    selectedProject,
  ]);
  const title = sessions.find((session) => session.id === sessionId)?.title ?? "新建对话";

  function selectSession(id: string, nextProjectId?: string) {
    // Opening a conversation nested under a project also switches the run
    // context to that project; plain "最近" items leave the context alone.
    if (nextProjectId !== undefined) setProjectId(nextProjectId);
    if (id === sessionId) return;
    setSessionId(id);
    setMessages([]);
  }

  function startNewSession() {
    setSessionId(createSessionId());
    setMessages([]);
  }

  function handleSelectProject(nextProjectId?: string) {
    setProjectId(nextProjectId);
    const inScope = sessions.filter(
      (session) => (session.projectId ?? undefined) === nextProjectId,
    );
    if (inScope.some((session) => session.id === sessionId)) return;
    if (inScope.length > 0) selectSession(inScope[0].id);
    else startNewSession();
  }

  async function deleteSession(id: string) {
    await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (id === sessionId) startNewSession();
    void refreshSessions();
  }

  return (
    <SidebarProvider className="h-screen min-w-0 overflow-hidden">
      <AppSidebar
        sessions={sessions}
        sessionId={sessionId}
        loading={loadingSessions}
        error={error}
        projects={projects}
        activeProjectId={projectId}
        onSelectProject={handleSelectProject}
        onSelect={selectSession}
        onNew={startNewSession}
        onDelete={(id) => void deleteSession(id)}
        onProjectsChanged={refreshProjects}
        onOpenSettings={() => setView("settings")}
      />
      <SidebarInset className="min-w-0">
        {view === "settings" ? (
          <SettingsPage
            onExit={() => setView("chat")}
            onChanged={() => {
              refreshProviders();
              refreshProjects();
              refreshAgents();
            }}
          />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1">
            <SessionView
              key={sessionId}
              sessionId={sessionId}
              title={title}
              providers={providers}
              requestSelection={modelSelection}
              displaySelection={displaySelection}
              onSelectionChange={setModelSelection}
              reasoningEffort={reasoningEffort}
              onReasoningEffortChange={setReasoningEffort}
              permissionMode={permissionMode}
              onPermissionModeChange={setPermissionMode}
              agentId={agentId}
              onAgentChange={setAgentId}
              projects={projects}
              projectId={projectId}
              onProjectChange={setProjectId}
              onProjectCreated={refreshProjects}
              initialMessages={initialMessages}
              onFinished={() => void refreshSessions()}
              panelOpen={panelOpen}
              onPanelOpenChange={setPanelOpen}
            />
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
