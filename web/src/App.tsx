import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { apiFetch, API_URL, listProviders, type ModelSelection, type ProviderInfo, type SessionSummary } from "./api";
import type { ThinkingMode } from "./api";
import { ChatPane } from "./components/ChatPane";
import { defaultModelSelection } from "./components/ModelSelector";
import { RightPanel, type RightTab } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { SettingsPage } from "./components/settings/SettingsPage";
import type { ChatUIMessage } from "./lib/chat-utils";
import { cn } from "./lib/utils";

const SESSION_KEY = "openharness.sessionId";
const THINKING_MODE_KEY = "openharness.thinkingMode";
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_DEFAULT = 400;

function createSessionId() {
  return crypto.randomUUID();
}

interface SessionViewProps {
  sessionId: string;
  title: string;
  providers: ProviderInfo[];
  selection: ModelSelection | null;
  onSelectionChange: (selection: ModelSelection) => void;
  thinkingMode: ThinkingMode;
  initialMessages: ChatUIMessage[];
  onFinished: () => void;
  onThinkingModeChange: (mode: ThinkingMode) => void;
}

function SessionView({
  sessionId,
  title,
  providers,
  selection,
  onSelectionChange,
  thinkingMode,
  initialMessages,
  onFinished,
  onThinkingModeChange,
}: SessionViewProps) {
  const [tab, setTab] = useState<RightTab>("files");
  const [selectedToolId, setSelectedToolId] = useState<string>();
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH_DEFAULT);
  const thinkingModeRef = useRef(thinkingMode);

  useEffect(() => {
    thinkingModeRef.current = thinkingMode;
  }, [thinkingMode]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: `${API_URL}/api/chat`,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            id: sessionId,
            messages,
            thinkingMode:
              body?.thinkingMode === "deep" || body?.thinkingMode === "fast"
                ? body.thinkingMode
                : thinkingModeRef.current,
            ...(selection ? { model: selection } : {}),
          },
        }),
      }),
    [sessionId, selection],
  );

  const chat: UseChatHelpers<ChatUIMessage> = useChat<ChatUIMessage>({
    id: sessionId,
    messages: initialMessages,
    transport,
    onFinish: async (event) => {
      const chatTitle = event.messages
        .filter((message) => message.role === "user")
        .at(-1)
        ?.parts.filter((part) => part.type === "text")
        .map((part) => ("text" in part ? part.text : ""))
        .join(" ")
        .slice(0, 80);

      await apiFetch(`/api/sessions/${sessionId}/messages`, {
        method: "PUT",
        body: JSON.stringify({ messages: event.messages, title: chatTitle || "New chat" }),
      }).catch(console.error);
      onFinished();
    },
  });

  const setChatMessages = chat.setMessages;
  useEffect(() => {
    setChatMessages(initialMessages);
  }, [initialMessages, setChatMessages]);

  const handleToolSelect = useCallback((id: string) => {
    setSelectedToolId(id);
    setTab("tools");
  }, []);

  const handleTogglePanel = useCallback(() => {
    setPanelOpen((open) => !open);
  }, []);

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
        selection={selection}
        onSelectionChange={onSelectionChange}
        thinkingMode={thinkingMode}
        onThinkingModeChange={onThinkingModeChange}
        selectedToolId={selectedToolId}
        onToolSelect={handleToolSelect}
        panelOpen={panelOpen}
        onTogglePanel={handleTogglePanel}
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
          messages={chat.messages}
          tab={tab}
          onTabChange={setTab}
          selectedToolId={selectedToolId}
          onToolSelect={setSelectedToolId}
          width={panelWidth}
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
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(() =>
    localStorage.getItem(THINKING_MODE_KEY) === "deep" ? "deep" : "fast",
  );
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(null);

  const refreshProviders = useCallback(() => {
    void listProviders()
      .then(setProviders)
      .catch(() => undefined);
  }, []);

  const effectiveSelection = useMemo(() => {
    if (
      modelSelection &&
      providers.some(
        (provider) =>
          provider.isActive &&
          provider.id === modelSelection.providerId &&
          provider.models.some(
            (model) => model.enabled && model.id === modelSelection.modelId,
          ),
      )
    ) {
      return modelSelection;
    }
    return defaultModelSelection(providers);
  }, [modelSelection, providers]);

  const refreshSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const data = await apiFetch<{ sessions: SessionSummary[] }>("/api/sessions");
      setSessions(data.sessions);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cannot reach local service");
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  useEffect(() => {
    localStorage.setItem(SESSION_KEY, sessionId);
  }, [sessionId]);

  useEffect(() => {
    localStorage.setItem(THINKING_MODE_KEY, thinkingMode);
  }, [thinkingMode]);

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
  const title = sessions.find((session) => session.id === sessionId)?.title ?? "New chat";

  function selectSession(id: string) {
    if (id === sessionId) return;
    setSessionId(id);
    setMessages([]);
  }

  function startNewSession() {
    setSessionId(createSessionId());
    setMessages([]);
  }

  async function deleteSession(id: string) {
    await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (id === sessionId) startNewSession();
    void refreshSessions();
  }

  return (
    <main className="flex h-screen min-w-0 overflow-hidden">
      <Sidebar
        sessions={sessions}
        sessionId={sessionId}
        loading={loadingSessions}
        error={error}
        onSelect={selectSession}
        onNew={startNewSession}
        onDelete={(id) => void deleteSession(id)}
        onRefresh={() => void refreshSessions()}
        onOpenSettings={() => setView("settings")}
      />
      {view === "settings" && (
        <SettingsPage
          onExit={() => setView("chat")}
          onChanged={refreshProviders}
        />
      )}
      <div className={cn("flex min-w-0 flex-1", view === "settings" && "hidden")}>
        <SessionView
          key={sessionId}
          sessionId={sessionId}
          title={title}
          providers={providers}
          selection={effectiveSelection}
          onSelectionChange={setModelSelection}
          thinkingMode={thinkingMode}
          onThinkingModeChange={setThinkingMode}
          initialMessages={initialMessages}
          onFinished={() => void refreshSessions()}
        />
      </div>
    </main>
  );
}
