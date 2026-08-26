import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { apiFetch, API_URL, fetchHealth, type HealthInfo, type SessionSummary } from "./api";
import type { ThinkingMode } from "./api";
import { ChatPane } from "./components/ChatPane";
import { RightPanel, type RightTab } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import type { ChatUIMessage } from "./lib/chat-utils";

const SESSION_KEY = "openharness.sessionId";
const THINKING_MODE_KEY = "openharness.thinkingMode";

function createSessionId() {
  return crypto.randomUUID();
}

interface SessionViewProps {
  sessionId: string;
  title: string;
  model?: string;
  thinkingMode: ThinkingMode;
  initialMessages: ChatUIMessage[];
  onFinished: () => void;
  onThinkingModeChange: (mode: ThinkingMode) => void;
}

function SessionView({
  sessionId,
  title,
  model,
  thinkingMode,
  initialMessages,
  onFinished,
  onThinkingModeChange,
}: SessionViewProps) {
  const [tab, setTab] = useState<RightTab>("files");
  const [selectedToolId, setSelectedToolId] = useState<string>();
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
          },
        }),
      }),
    [sessionId],
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

  return (
    <>
      <ChatPane
        chat={chat}
        title={title}
        model={model}
        thinkingMode={thinkingMode}
        onThinkingModeChange={onThinkingModeChange}
        selectedToolId={selectedToolId}
        onToolSelect={handleToolSelect}
      />
      <RightPanel
        messages={chat.messages}
        tab={tab}
        onTabChange={setTab}
        selectedToolId={selectedToolId}
        onToolSelect={setSelectedToolId}
      />
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
  const [health, setHealth] = useState<HealthInfo>();
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(() =>
    localStorage.getItem(THINKING_MODE_KEY) === "deep" ? "deep" : "fast",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshHealth = useCallback(() => {
    void fetchHealth()
      .then(setHealth)
      .catch(() => undefined);
  }, []);

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
    refreshHealth();
  }, [refreshHealth]);

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
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SessionView
        key={sessionId}
        sessionId={sessionId}
        title={title}
        model={health?.model}
        thinkingMode={thinkingMode}
        onThinkingModeChange={setThinkingMode}
        initialMessages={initialMessages}
        onFinished={() => void refreshSessions()}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onChanged={refreshHealth}
      />
    </main>
  );
}
