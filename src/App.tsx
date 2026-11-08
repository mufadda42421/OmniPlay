
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import "./App.css";

import {
  Activity, ArrowUpRight, Bot, ChevronDown, CircleHelp, Code2,
  Command, FileText, History, KeyRound, Layers3, MessageSquarePlus,
  MoreHorizontal, PanelLeftClose, Play, Plus, Settings2,
  SlidersHorizontal, Sparkles, SquareTerminal, WandSparkles, X,
  Square, Copy, Check, RotateCw, Eye, EyeOff, Trash2,
  ShieldCheck, Search, Save, Pencil, Clock3, Star, Settings,
  FolderOpen, ExternalLink, RefreshCw, MessageSquare, Database,
} from "lucide-react";

type ProviderId =
  | "groq" | "openai" | "gemini" | "anthropic"
  | "openrouter" | "mistral" | "cerebras";

type Provider = {
  id: ProviderId;
  name: string;
};

type Model = {
  id: string;
  name: string;
  provider: string;
  providerId?: string;
  context: number;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Section =
  | "Playground"
  | "Prompt library"
  | "History"
  | "Models"
  | "Settings";

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  provider: ProviderId;
  model: string;
  createdAt: number;
  updatedAt: number;
};

type SavedPrompt = {
  id: string;
  title: string;
  content: string;
  systemPrompt: string;
  category: string;
  createdAt: number;
  updatedAt: number;
};

type AppPreferences = {
  defaultProvider: ProviderId;
  defaultTemperature: number;
  defaultMaxTokens: number;
  saveHistory: boolean;
};

const CONVERSATIONS_KEY = "omniplay-conversations";
const LEGACY_MESSAGES_KEY = "omniplay-messages";
const PROMPTS_KEY = "omniplay-prompt-library";
const PREFERENCES_KEY = "omniplay-preferences";
const API_KEY_PREFIX = "omniplay-api-key-";

const providers: Provider[] = [
  { id: "groq", name: "Groq" },
  { id: "openai", name: "OpenAI" },
  { id: "gemini", name: "Google Gemini" },
  { id: "anthropic", name: "Anthropic" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "mistral", name: "Mistral AI" },
  { id: "cerebras", name: "Cerebras" },
];

const defaultPreferences: AppPreferences = {
  defaultProvider: "groq",
  defaultTemperature: 0.7,
  defaultMaxTokens: 2048,
  saveHistory: true,
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeRead<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadConversations(): Conversation[] {
  const saved = safeRead<Conversation[]>(CONVERSATIONS_KEY, []);
  if (Array.isArray(saved) && saved.length) return saved;

  // Migrate the original single-chat storage into conversation history.
  const oldMessages = safeRead<Message[]>(LEGACY_MESSAGES_KEY, []);
  if (Array.isArray(oldMessages) && oldMessages.length) {
    return [{
      id: makeId(),
      title: oldMessages.find((m) => m.role === "user")?.content.slice(0, 48) || "Previous experiment",
      messages: oldMessages,
      provider: "groq",
      model: "openai/gpt-oss-20b",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
  }

  return [];
}

function loadApiKeys(): Record<ProviderId, string> {
  const result = {} as Record<ProviderId, string>;

  for (const provider of providers) {
    try {
      result[provider.id] =
        sessionStorage.getItem(API_KEY_PREFIX + provider.id) || "";
    } catch {
      result[provider.id] = "";
    }
  }

  return result;
}

function App() {
  const [section, setSection] = useState<Section>("Playground");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [conversations, setConversations] =
    useState<Conversation[]>(loadConversations);
  const [activeConversationId, setActiveConversationId] =
    useState<string | null>(null);

  const [promptLibrary, setPromptLibrary] =
    useState<SavedPrompt[]>(() => safeRead(PROMPTS_KEY, []));

  const [preferences, setPreferences] =
    useState<AppPreferences>(() => ({
      ...defaultPreferences,
      ...safeRead(PREFERENCES_KEY, {}),
    }));

  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemOpen, setSystemOpen] = useState(false);

  const [provider, setProvider] = useState<ProviderId>(
    preferences.defaultProvider
  );
  const [models, setModels] = useState<Model[]>([]);
  const [allModels, setAllModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const [apiKeys, setApiKeys] =
    useState<Record<ProviderId, string>>(loadApiKeys);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [groqFallbackConfigured, setGroqFallbackConfigured] = useState(false);

  const [temperature, setTemperature] =
    useState(preferences.defaultTemperature);
  const [maxTokens, setMaxTokens] =
    useState(preferences.defaultMaxTokens);

  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [librarySearch, setLibrarySearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [modelProviderFilter, setModelProviderFilter] =
    useState<ProviderId | "all">("all");

  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptTitle, setPromptTitle] = useState("");
  const [promptContent, setPromptContent] = useState("");
  const [promptSystem, setPromptSystem] = useState("");
  const [promptCategory, setPromptCategory] = useState("General");

  const [renamingConversationId, setRenamingConversationId] =
    useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  const activeConversation = conversations.find(
    (item) => item.id === activeConversationId
  );

  const messages = activeConversation?.messages || [];
  const selectedModel = models.find((item) => item.id === model);
  const selectedProvider = providers.find((item) => item.id === provider);
  const activeApiKey = apiKeys[provider] || "";
  const promptLength = prompt.length;

  const providerReady =
    Boolean(activeApiKey.trim()) ||
    (provider === "groq" && groqFallbackConfigured);

  const filteredPrompts = useMemo(() => {
    const query = librarySearch.toLowerCase().trim();

    return promptLibrary.filter((item) =>
      !query ||
      item.title.toLowerCase().includes(query) ||
      item.content.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query)
    );
  }, [promptLibrary, librarySearch]);

  const filteredConversations = useMemo(() => {
    const query = historySearch.toLowerCase().trim();

    return [...conversations]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((item) =>
        !query ||
        item.title.toLowerCase().includes(query) ||
        item.messages.some((message) =>
          message.content.toLowerCase().includes(query)
        )
      );
  }, [conversations, historySearch]);

  const visibleModels = useMemo(() => {
    const query = modelSearch.toLowerCase().trim();

    return allModels.filter((item) => {
      const providerMatches =
        modelProviderFilter === "all" ||
        (item.providerId || item.provider).toLowerCase() === modelProviderFilter;

      const textMatches =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query) ||
        item.provider.toLowerCase().includes(query);

      return providerMatches && textMatches;
    });
  }, [allModels, modelSearch, modelProviderFilter]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  }

  function updateConversation(
    id: string,
    updater: (conversation: Conversation) => Conversation
  ) {
    setConversations((current) =>
      current.map((item) => item.id === id ? updater(item) : item)
    );
  }

  function updateActiveMessages(nextMessages: Message[]) {
    if (!activeConversationId) return;

    updateConversation(activeConversationId, (conversation) => ({
      ...conversation,
      messages: nextMessages,
      updatedAt: Date.now(),
    }));
  }

  useEffect(() => {
    try {
      localStorage.setItem(
        CONVERSATIONS_KEY,
        JSON.stringify(conversations)
      );
    } catch {
      setNotice("Couldn't save history. Browser storage may be full.");
    }
  }, [conversations]);

  useEffect(() => {
    try {
      localStorage.setItem(PROMPTS_KEY, JSON.stringify(promptLibrary));
    } catch {
      setNotice("Couldn't save prompt library.");
    }
  }, [promptLibrary]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      setNotice("Couldn't save preferences.");
    }
  }, [preferences]);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => {
        if (!response.ok) throw new Error("Backend unavailable");
        return response.json();
      })
      .then((data) => {
        setGroqFallbackConfigured(Boolean(data.providerConfigured));
      })
      .catch(() => {
        setError("Can't reach the OmniPlay backend. Is the API server running?");
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    setModels([]);
    setModel("");
    setModelMenuOpen(false);

    fetch(`/api/models?provider=${encodeURIComponent(provider)}`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load models");
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;

        if (Array.isArray(data.models)) {
          setModels(data.models);
          setModel(data.models[0]?.id || "");

          setAllModels((current) => {
            const others = current.filter(
              (item) =>
                (item.providerId || item.provider).toLowerCase() !== provider
            );

            const additions = data.models.map((item: Model) => ({
              ...item,
              providerId: provider,
              provider: providers.find((p) => p.id === provider)?.name || provider,
            }));

            return [...others, ...additions];
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(`Couldn't load ${selectedProvider?.name || provider} models.`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    responseRef.current?.scrollTo({
      top: responseRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  function updateApiKey(value: string) {
    setApiKeys((current) => ({ ...current, [provider]: value }));
  }

  function saveApiKey() {
    const key = activeApiKey.trim();

    if (!key) {
      showNotice("Enter an API key before saving.");
      return;
    }

    try {
      sessionStorage.setItem(API_KEY_PREFIX + provider, key);
      setApiKeys((current) => ({ ...current, [provider]: key }));
      showNotice(`${selectedProvider?.name} key saved for this browser tab.`);
    } catch {
      showNotice("Browser session storage is unavailable.");
    }
  }

  function clearApiKey() {
    try {
      sessionStorage.removeItem(API_KEY_PREFIX + provider);
    } catch {
      // The in-memory value is still cleared below.
    }

    setApiKeys((current) => ({ ...current, [provider]: "" }));
    showNotice(`${selectedProvider?.name} API key cleared.`);
  }

  function createConversation() {
    if (streaming) stopGeneration();

    const conversation: Conversation = {
      id: makeId(),
      title: "New experiment",
      messages: [],
      provider,
      model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setPrompt("");
    setError("");
    setSection("Playground");
    showNotice("New playground created.");
  }

  function openConversation(conversation: Conversation) {
    if (streaming) stopGeneration();

    setActiveConversationId(conversation.id);
    setProvider(conversation.provider);
    setSection("Playground");
    setPrompt("");
    setError("");
  }

  function deleteConversation(id: string) {
    setConversations((current) => current.filter((item) => item.id !== id));

    if (activeConversationId === id) {
      setActiveConversationId(null);
    }

    showNotice("Conversation deleted.");
  }

  function startRename(conversation: Conversation) {
    setRenamingConversationId(conversation.id);
    setConversationTitle(conversation.title);
  }

  function saveConversationRename() {
    if (!renamingConversationId || !conversationTitle.trim()) return;

    updateConversation(renamingConversationId, (conversation) => ({
      ...conversation,
      title: conversationTitle.trim(),
    }));

    setRenamingConversationId(null);
    showNotice("Conversation renamed.");
  }

  function openPromptEditor(item?: SavedPrompt) {
    setEditingPromptId(item?.id || null);
    setPromptTitle(item?.title || "");
    setPromptContent(item?.content || "");
    setPromptSystem(item?.systemPrompt || "");
    setPromptCategory(item?.category || "General");
    setPromptEditorOpen(true);
  }

  function savePrompt() {
    if (!promptTitle.trim() || !promptContent.trim()) {
      showNotice("A prompt title and prompt content are required.");
      return;
    }

    if (editingPromptId) {
      setPromptLibrary((current) =>
        current.map((item) =>
          item.id === editingPromptId
            ? {
                ...item,
                title: promptTitle.trim(),
                content: promptContent.trim(),
                systemPrompt: promptSystem.trim(),
                category: promptCategory.trim() || "General",
                updatedAt: Date.now(),
              }
            : item
        )
      );
      showNotice("Prompt updated.");
    } else {
      const item: SavedPrompt = {
        id: makeId(),
        title: promptTitle.trim(),
        content: promptContent.trim(),
        systemPrompt: promptSystem.trim(),
        category: promptCategory.trim() || "General",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setPromptLibrary((current) => [item, ...current]);
      showNotice("Prompt saved to your library.");
    }

    setPromptEditorOpen(false);
  }

  function deletePrompt(id: string) {
    setPromptLibrary((current) => current.filter((item) => item.id !== id));
    showNotice("Prompt deleted.");
  }

  function useSavedPrompt(item: SavedPrompt) {
    setPrompt(item.content);
    setSystemPrompt(item.systemPrompt);
    setSection("Playground");
    showNotice(`Loaded "${item.title}" into the playground.`);
  }

  function saveCurrentPrompt() {
    if (!prompt.trim()) {
      showNotice("Write a prompt before saving it.");
      return;
    }

    openPromptEditor({
      id: "",
      title: prompt.slice(0, 42),
      content: prompt,
      systemPrompt,
      category: "General",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setEditingPromptId(null);
  }

  async function runPrompt() {
    if (streaming) return;

    if (!prompt.trim()) {
      setError("Write a prompt before running the model.");
      return;
    }

    if (!providerReady) {
      setError(
        `Add your ${selectedProvider?.name} API key in Settings before running a prompt.`
      );
      return;
    }

    if (!model) {
      setError("Select a model before running your prompt.");
      return;
    }

    setError("");

    let conversationId = activeConversationId;

    if (!conversationId) {
      const newConversation: Conversation = {
        id: makeId(),
        title: prompt.trim().slice(0, 48),
        messages: [],
        provider,
        model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      conversationId = newConversation.id;
      setActiveConversationId(conversationId);
      setConversations((current) => [newConversation, ...current]);
    }

    const currentConversation = conversations.find(
      (item) => item.id === conversationId
    );

    const previousMessages = currentConversation?.messages || [];

    const userMessage: Message = {
      role: "user",
      content: prompt.trim(),
    };

    const nextMessages: Message[] = [
      ...previousMessages,
      userMessage,
      { role: "assistant", content: "" },
    ];

    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title:
        conversation.messages.length === 0
          ? userMessage.content.slice(0, 48)
          : conversation.title,
      provider,
      model,
      messages: nextMessages,
      updatedAt: Date.now(),
    }));

    if (!currentConversation) {
      setConversations((current) =>
        current.map((item) =>
          item.id === conversationId
            ? { ...item, title: userMessage.content.slice(0, 48), messages: nextMessages }
            : item
        )
      );
    }

    setPrompt("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          provider,
          apiKey: activeApiKey.trim(),
          model,
          prompt: userMessage.content,
          systemPrompt,
          temperature,
          maxTokens,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error("Streaming is not supported by this browser.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function appendDelta(delta: string) {
        if (!delta) return;

        setConversations((current) =>
          current.map((conversation) => {
            if (conversation.id !== conversationId) return conversation;

            const updated = [...conversation.messages];
            const last = updated[updated.length - 1];

            if (last?.role !== "assistant") return conversation;

            updated[updated.length - 1] = {
              ...last,
              content: last.content + delta,
            };

            return {
              ...conversation,
              messages: updated,
              updatedAt: Date.now(),
            };
          })
        );
      }

      function processEvent(event: string) {
        const lines = event.split("\n");
        const dataLines = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());

        if (!dataLines.length) return;

        const payload = dataLines.join("\n");
        if (payload === "[DONE]") return;

        try {
          const data = JSON.parse(payload);

          if (data.error) throw new Error(data.error);

          const delta = data.choices?.[0]?.delta?.content;
          if (typeof delta === "string") appendDelta(delta);
        } catch (parseError) {
          if (
            parseError instanceof Error &&
            !parseError.message.includes("JSON")
          ) {
            throw parseError;
          }
        }
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) processEvent(event);
      }

      buffer += decoder.decode();
      if (buffer.trim()) processEvent(buffer);
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);

        setConversations((current) =>
          current.map((conversation) => {
            if (conversation.id !== conversationId) return conversation;

            const updated = [...conversation.messages];
            const last = updated[updated.length - 1];

            if (last?.role === "assistant" && !last.content) {
              updated.pop();
            }

            return { ...conversation, messages: updated };
          })
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showNotice("Copied to clipboard.");
    } catch {
      showNotice("Clipboard access isn't available in this browser.");
    }
  }

  function updatePreference<K extends keyof AppPreferences>(
    key: K,
    value: AppPreferences[K]
  ) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  function resetRunSettings() {
    setTemperature(0.7);
    setMaxTokens(2048);
    showNotice("Run settings reset.");
  }

  const navItems: {
    label: Section;
    icon: typeof WandSparkles;
  }[] = [
    { label: "Playground", icon: WandSparkles },
    { label: "Prompt library", icon: FileText },
    { label: "History", icon: History },
    { label: "Models", icon: Layers3 },
    { label: "Settings", icon: Settings2 },
  ];

  const sectionDescriptions: Record<Section, string> = {
    Playground: "Experiment with prompts, tune parameters, and explore model behavior.",
    "Prompt library": "Save, organize, and reuse your favorite prompts.",
    History: "Pick up where you left off with your previous experiments.",
    Models: "Explore available models across your connected AI providers.",
    Settings: "Manage your providers, API keys, and workspace preferences.",
  };

  const panelStyle: React.CSSProperties = {
    background: "#1D2027",
    border: "1px solid #303540",
    borderRadius: 12,
    padding: 18,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 12px",
    borderRadius: 7,
    border: "1px solid #303540",
    background: "#111318",
    color: "#ECEEF2",
    fontSize: 13,
    outline: "none",
  };

  const smallLabelStyle: React.CSSProperties = {
    display: "block",
    color: "#9299A6",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "1px",
    marginBottom: 9,
  };

  const actionButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    border: "1px solid #3A414E",
    borderRadius: 7,
    background: "#252933",
    color: "#ECEEF2",
    padding: "9px 12px",
    fontSize: 12,
    cursor: "pointer",
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button
            className="icon-button sidebar-toggle"
            aria-label="Toggle sidebar"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <PanelLeftClose size={17} />
          </button>

          <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
            <span className="brand-mark"><Sparkles size={16} /></span>
            <span>omni<span className="brand-light">play</span></span>
            <span className="brand-beta">LAB</span>
          </a>

          <span className="topbar-divider" />

          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="crumb-slash">/</span>
            <strong>{section}</strong>
          </div>
        </div>

        <div className="topbar-right">
          <div className="status-pill">
            <span className={`status-dot ${providerReady ? "" : "status-off"}`} />
            {providerReady ? `${selectedProvider?.name} connected` : "API key required"}
          </div>

          <button
            className="icon-button"
            aria-label="Help"
            onClick={() => showNotice("Choose a provider and add its API key in Settings.")}
          >
            <CircleHelp size={17} />
          </button>

          <button className="avatar" aria-label="Account">M</button>
        </div>
      </header>

      <div className="workspace">
        {sidebarOpen && (
          <aside className="sidebar">
            <button className="new-session" onClick={createConversation}>
              <Plus size={16} />
              <span>New playground</span>
              <kbd>⌘ K</kbd>
            </button>

            <div className="sidebar-group">
              <div className="sidebar-label">WORKSPACE</div>

              {navItems.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  className={`nav-item ${section === label ? "active" : ""}`}
                  onClick={() => setSection(label)}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  {label === "Models" && <span className="nav-count">{allModels.length || models.length}</span>}
                  {label === "History" && <span className="nav-count">{conversations.length}</span>}
                  {label === "Prompt library" && <span className="nav-count">{promptLibrary.length}</span>}
                </button>
              ))}
            </div>

            <div className="sidebar-group recent-group">
              <div className="sidebar-label row-label">
                <span>RECENT</span>
                <button className="tiny-icon" aria-label="Open history" onClick={() => setSection("History")}>
                  <MoreHorizontal size={15} />
                </button>
              </div>

              {conversations.slice(0, 5).map((conversation) => (
                <button
                  className="recent-item"
                  key={conversation.id}
                  onClick={() => openConversation(conversation)}
                  title={conversation.title}
                >
                  <MessageSquarePlus size={15} />
                  <span>{conversation.title}</span>
                  {conversation.id === activeConversationId && <span className="recent-live" />}
                </button>
              ))}

              {!conversations.length && (
                <div className="recent-empty">Your recent experiments will appear here.</div>
              )}
            </div>

            <div className="sidebar-spacer" />

            <div className="sidebar-bottom-card">
              <div className="upgrade-icon"><Activity size={16} /></div>
              <div>
                <strong>Provider connection</strong>
                <p>{providerReady ? `${selectedProvider?.name} is ready.` : "Add a provider API key to get started."}</p>
              </div>
              <ArrowUpRight size={14} className="subtle-arrow" />
            </div>

            <button
              className={`nav-item settings-nav ${section === "Settings" ? "active" : ""}`}
              onClick={() => setSection("Settings")}
            >
              <Settings2 size={16} />
              <span>Settings</span>
            </button>

            <div className="sidebar-footer">
              <span className="footer-avatar">M</span>
              <div><strong>My workspace</strong><small>Local development</small></div>
              <MoreHorizontal size={16} />
            </div>
          </aside>
        )}

        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" />MODEL WORKSPACE</div>
              <h1>{section}</h1>
              <p>{sectionDescriptions[section]}</p>
            </div>

            <div className="heading-actions">
              {section === "Prompt library" && (
                <button className="secondary-button" onClick={() => openPromptEditor()}>
                  <Plus size={15} /> New prompt
                </button>
              )}
              {section === "History" && (
                <button className="secondary-button" onClick={createConversation}>
                  <Plus size={15} /> New playground
                </button>
              )}
              <button
                className="secondary-button"
                onClick={() => showNotice("You're using the local OmniPlay workspace.")}
              >
                <CircleHelp size={15} /> Help
              </button>
            </div>
          </div>

          {section === "Playground" && (
            <div className="playground-grid">
              <section className="editor-column">
                <div className="panel prompt-panel">
                  <div className="panel-header">
                    <div className="panel-title">
                      <span className="panel-icon"><MessageSquarePlus size={15} /></span>
                      <div><strong>Prompt</strong><small>Define the input for your model</small></div>
                    </div>

                    <div className="panel-tools">
                      <span className="soft-tag">TEXT</span>
                      <button className="icon-button small" aria-label="Save prompt" onClick={saveCurrentPrompt}>
                        <Save size={15} />
                      </button>
                    </div>
                  </div>

                  <textarea
                    className="prompt-input"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void runPrompt();
                      }
                    }}
                    placeholder={"Write your prompt here...\n\nAsk a question, provide context, or describe a task for the model."}
                    spellCheck={false}
                  />

                  <div className="prompt-footer">
                    <div className="prompt-hints">
                      <span><Command size={12} /> + Enter to run</span>
                      <span className="hint-divider" />
                      <span>{promptLength} characters</span>
                    </div>
                    <button className="text-button" onClick={() => setPrompt("")}><X size={13} /> Clear</button>
                  </div>
                </div>

                <button
                  className={`system-prompt-toggle ${systemOpen ? "expanded" : ""}`}
                  onClick={() => setSystemOpen(!systemOpen)}
                >
                  <span className="toggle-leading"><Code2 size={15} /></span>
                  <span><strong>System instructions</strong><small>Set the behavior and role of the model</small></span>
                  <ChevronDown size={16} className="toggle-chevron" />
                </button>

                {systemOpen && (
                  <div className="panel system-panel">
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="You are a helpful assistant..."
                    />
                    <div className="system-footnote">These instructions are sent before your prompt.</div>
                  </div>
                )}

                <div className="response-panel panel">
                  <div className="panel-header response-header">
                    <div className="panel-title">
                      <span className="panel-icon response-icon"><Bot size={16} /></span>
                      <div><strong>Response</strong><small>{selectedModel?.name || "Model output"}</small></div>
                    </div>
                    <span className="waiting-label">
                      <span className={`waiting-dot ${streaming ? "pulse" : ""}`} />
                      {streaming ? "GENERATING" : "LIVE OUTPUT"}
                    </span>
                  </div>

                  <div className="response-content" ref={responseRef}>
                    {!messages.length && (
                      <div className="empty-response">
                        <div className="empty-orbit">
                          <div className="orbit-core"><Sparkles size={21} /></div>
                          <span className="orbit-dot orbit-dot-one" />
                          <span className="orbit-dot orbit-dot-two" />
                          <span className="orbit-dot orbit-dot-three" />
                        </div>
                        <strong>Your next idea starts here.</strong>
                        <p>Choose a provider, select a model, and run your first experiment.</p>
                        <div className="empty-shortcuts">
                          <span><kbd>⌘</kbd><kbd>↵</kbd> Run prompt</span>
                          <span><kbd>⌘</kbd><kbd>⇧</kbd><kbd>P</kbd> Command menu</span>
                        </div>
                      </div>
                    )}

                    {messages.map((message, index) => (
                      <div className={`chat-message ${message.role}`} key={`${index}-${message.role}`}>
                        <div className="message-meta">
                          <span>{message.role === "user" ? "YOU" : selectedModel?.name || "ASSISTANT"}</span>
                          {message.role === "assistant" && message.content && (
                            <button className="message-copy" onClick={() => void copyText(message.content)}>
                              <Copy size={12} /> Copy
                            </button>
                          )}
                        </div>

                        <div className="message-body">
                          {message.content ? (
                            message.role === "assistant" ? (
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeHighlight]}
                              >
                                {message.content}
                              </ReactMarkdown>
                            ) : message.content
                          ) : streaming && index === messages.length - 1 ? (
                            <span className="typing-indicator"><i /><i /><i /></span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="error-banner">
                    <span>{error}</span>
                    <button onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button>
                  </div>
                )}
              </section>

              <aside className="settings-column">
                <div className="panel settings-panel">
                  <div className="settings-heading">
                    <div><SlidersHorizontal size={15} /><strong>Run settings</strong></div>
                    <button className="icon-button small" aria-label="Reset settings" onClick={resetRunSettings}>
                      <RotateCw size={14} />
                    </button>
                  </div>

                  <div className="setting-block">
                    <label className="field-label">PROVIDER</label>
                    <select
                      className="model-select"
                      value={provider}
                      onChange={(e) => {
                        setProvider(e.target.value as ProviderId);
                        setApiKeyVisible(false);
                        setError("");
                      }}
                      style={{ width: "100%", color: "inherit", backgroundColor: "transparent", cursor: "pointer" }}
                    >
                      {providers.map((item) => (
                        <option key={item.id} value={item.id} style={{ background: "#1D2027", color: "#ECEEF2" }}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <div className="field-caption">Switch between seven supported AI providers.</div>
                  </div>

                  <div className="settings-separator" />

                  <div className="setting-block">
                    <div className="label-row">
                      <label className="field-label">API KEY MANAGER</label>
                      <span style={{ fontSize: 10, color: providerReady ? "#8BC99B" : "#9299A6" }}>
                        {providerReady ? "CONNECTED" : "NOT CONNECTED"}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10 }}>
                      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                        <input
                          type={apiKeyVisible ? "text" : "password"}
                          value={activeApiKey}
                          onChange={(e) => updateApiKey(e.target.value)}
                          placeholder={provider === "groq" && groqFallbackConfigured ? "Using server key (optional)" : `Enter ${selectedProvider?.name} API key`}
                          autoComplete="off"
                          spellCheck={false}
                          style={{ width: "100%", boxSizing: "border-box", minWidth: 0, padding: "11px 36px 11px 11px", borderRadius: 7, border: "1px solid #303540", background: "#111318", color: "#ECEEF2", fontSize: 12, outline: "none" }}
                        />
                        <button
                          type="button"
                          aria-label={apiKeyVisible ? "Hide API key" : "Show API key"}
                          onClick={() => setApiKeyVisible(!apiKeyVisible)}
                          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", color: "#9299A6", cursor: "pointer", padding: 3 }}
                        >
                          {apiKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
                      <button className="secondary-button" onClick={saveApiKey} style={{ flex: 1, justifyContent: "center" }}>
                        <KeyRound size={13} /> Save key
                      </button>
                      <button className="icon-button bordered" onClick={clearApiKey} aria-label="Clear API key" title="Clear saved key">
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="field-caption">
                      {provider === "groq" && groqFallbackConfigured && !activeApiKey
                        ? "Your existing server Groq key will be used."
                        : activeApiKey
                          ? "Key entered. Save it to keep it for this browser tab."
                          : "Your key is sent to your local backend when you run a prompt."}
                    </div>
                  </div>

                  <div className="settings-separator" />

                  <div className="setting-block">
                    <label className="field-label">MODEL <span className="required-mark">•</span></label>
                    <button
                      className={`model-select ${modelMenuOpen ? "select-open" : ""}`}
                      onClick={() => setModelMenuOpen(!modelMenuOpen)}
                      disabled={!models.length}
                    >
                      <span className="model-select-left">
                        <span className="model-glyph"><Bot size={16} /></span>
                        <span>{selectedModel?.name || "Loading models..."}</span>
                      </span>
                      <ChevronDown size={15} />
                    </button>

                    {modelMenuOpen && (
                      <div className="model-menu">
                        <div className="model-menu-note">{selectedProvider?.name.toUpperCase()} MODELS</div>
                        {models.map((item) => (
                          <button key={item.id} onClick={() => { setModel(item.id); setModelMenuOpen(false); }}>
                            <Bot size={14} /><span>{item.name}</span>
                            {model === item.id && <Check size={13} />}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="field-caption">{models.length} models available through {selectedProvider?.name}.</div>
                  </div>

                  <div className="settings-separator" />

                  <div className="setting-block">
                    <div className="label-row"><label className="field-label">TEMPERATURE</label><output>{temperature.toFixed(1)}</output></div>
                    <input className="range-input" type="range" min="0" max="2" step=".1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
                    <div className="range-ends"><span>Precise</span><span>Creative</span></div>
                  </div>

                  <div className="settings-separator" />

                  <div className="setting-block">
                    <div className="label-row"><label className="field-label">MAX OUTPUT TOKENS</label><output>{maxTokens.toLocaleString()}</output></div>
                    <input className="range-input" type="range" min="256" max="8192" step="256" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
                    <div className="range-ends"><span>256</span><span>8,192</span></div>
                  </div>
                </div>

                <div className="provider-card">
                  <div className="provider-card-top">
                    <span className="provider-card-icon"><KeyRound size={15} /></span>
                    <span className="provider-status">{providerReady ? "CONNECTED" : "NOT CONNECTED"}</span>
                  </div>
                  <strong>{providerReady ? `${selectedProvider?.name} is connected` : `Connect ${selectedProvider?.name}`}</strong>
                  <p>{providerReady ? `OmniPlay is ready to send requests to ${selectedProvider?.name}.` : `Add your ${selectedProvider?.name} API key above to enable model responses.`}</p>
                  <button onClick={() => setSection("Settings")}>Open settings <ArrowUpRight size={14} /></button>
                </div>

                <div className="privacy-note">
                  <span className="privacy-lock"><ShieldCheck size={12} /></span>
                  Keys stay out of frontend source code. Use a secure secrets vault for production.
                </div>
              </aside>
            </div>
          )}

          {section === "Prompt library" && (
            <section style={{ display: "grid", gap: 16 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ ...panelStyle, flex: 1, minWidth: 220, display: "flex", alignItems: "center", gap: 10, padding: "10px 13px" }}>
                  <Search size={16} color="#9299A6" />
                  <input
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="Search your saved prompts..."
                    style={{ ...inputStyle, border: 0, background: "transparent", padding: 2 }}
                  />
                </div>
                <button className="secondary-button" onClick={() => openPromptEditor()}>
                  <Plus size={15} /> Create prompt
                </button>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", color: "#9299A6", fontSize: 12 }}>
                <span>{filteredPrompts.length} saved prompts</span>
                <span>Stored in this browser</span>
              </div>

              {filteredPrompts.length ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
                  {filteredPrompts.map((item) => (
                    <article key={item.id} style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "#A8C7FA", fontSize: 10, letterSpacing: 1, fontWeight: 700 }}>{item.category.toUpperCase()}</span>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button className="icon-button small" title="Edit prompt" onClick={() => openPromptEditor(item)}><Pencil size={14} /></button>
                          <button className="icon-button small" title="Delete prompt" onClick={() => deletePrompt(item.id)}><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <strong style={{ color: "#ECEEF2", fontSize: 15 }}>{item.title}</strong>
                      <p style={{ color: "#A7ADBA", fontSize: 12, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {item.content.length > 180 ? `${item.content.slice(0, 180)}…` : item.content}
                      </p>
                      {item.systemPrompt && <span style={{ color: "#9299A6", fontSize: 11 }}>Includes system instructions</span>}
                      <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "#777F8D", fontSize: 10 }}>{new Date(item.updatedAt).toLocaleDateString()}</span>
                        <button className="secondary-button" onClick={() => useSavedPrompt(item)}><Play size={12} /> Use prompt</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div style={{ ...panelStyle, textAlign: "center", padding: 48 }}>
                  <FolderOpen size={28} color="#9299A6" />
                  <h2 style={{ color: "#ECEEF2", fontSize: 17 }}>Your prompt library is empty</h2>
                  <p style={{ color: "#9299A6", fontSize: 13 }}>Save useful prompts here so you can reuse them in any experiment.</p>
                  <button className="secondary-button" onClick={() => openPromptEditor()}><Plus size={14} /> Create your first prompt</button>
                </div>
              )}
            </section>
          )}

          {section === "History" && (
            <section style={{ display: "grid", gap: 14 }}>
              <div style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 10, padding: "10px 13px" }}>
                <Search size={16} color="#9299A6" />
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search conversations and messages..."
                  style={{ ...inputStyle, border: 0, background: "transparent", padding: 2 }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", color: "#9299A6", fontSize: 12 }}>
                <span>{filteredConversations.length} conversations</span>
                <span>Newest first</span>
              </div>

              {filteredConversations.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {filteredConversations.map((conversation) => (
                    <article key={conversation.id} style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                      <div style={{ width: 38, height: 38, borderRadius: 9, background: "#252D3B", display: "grid", placeItems: "center", color: "#A8C7FA" }}>
                        <MessageSquare size={17} />
                      </div>

                      <div style={{ flex: 1, minWidth: 180 }}>
                        {renamingConversationId === conversation.id ? (
                          <div style={{ display: "flex", gap: 7 }}>
                            <input value={conversationTitle} onChange={(e) => setConversationTitle(e.target.value)} style={inputStyle} autoFocus />
                            <button style={actionButtonStyle} onClick={saveConversationRename}><Check size={14} /></button>
                            <button style={actionButtonStyle} onClick={() => setRenamingConversationId(null)}><X size={14} /></button>
                          </div>
                        ) : (
                          <strong style={{ display: "block", color: "#ECEEF2", fontSize: 13 }}>{conversation.title}</strong>
                        )}
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6, color: "#9299A6", fontSize: 11 }}>
                          <span><Clock3 size={11} style={{ verticalAlign: "middle" }} /> {new Date(conversation.updatedAt).toLocaleString()}</span>
                          <span>{conversation.messages.length} messages</span>
                          <span>{providers.find((p) => p.id === conversation.provider)?.name || conversation.provider}</span>
                        </div>
                        {conversation.messages[0] && (
                          <p style={{ color: "#9299A6", fontSize: 11, margin: "8px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {conversation.messages[0].content}
                          </p>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: 6 }}>
                        <button style={actionButtonStyle} onClick={() => openConversation(conversation)}><ExternalLink size={13} /> Open</button>
                        <button style={actionButtonStyle} title="Rename" onClick={() => startRename(conversation)}><Pencil size={13} /></button>
                        <button style={actionButtonStyle} title="Delete" onClick={() => deleteConversation(conversation.id)}><Trash2 size={13} /></button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div style={{ ...panelStyle, textAlign: "center", padding: 48 }}>
                  <History size={28} color="#9299A6" />
                  <h2 style={{ color: "#ECEEF2", fontSize: 17 }}>No conversations found</h2>
                  <p style={{ color: "#9299A6", fontSize: 13 }}>Run a prompt in the playground and your conversation will appear here.</p>
                  <button className="secondary-button" onClick={createConversation}><Plus size={14} /> Start experimenting</button>
                </div>
              )}
            </section>
          )}

          {section === "Models" && (
            <section style={{ display: "grid", gap: 15 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ ...panelStyle, flex: 1, minWidth: 220, display: "flex", alignItems: "center", gap: 10, padding: "10px 13px" }}>
                  <Search size={16} color="#9299A6" />
                  <input value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder="Search model name or ID..." style={{ ...inputStyle, border: 0, background: "transparent", padding: 2 }} />
                </div>
                <select
                  value={modelProviderFilter}
                  onChange={(e) => setModelProviderFilter(e.target.value as ProviderId | "all")}
                  style={{ ...inputStyle, width: "auto", minWidth: 160 }}
                >
                  <option value="all">All providers</option>
                  {providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button style={actionButtonStyle} onClick={() => setProvider(provider)}><RefreshCw size={14} /> Refresh catalog</button>
              </div>

              <div style={{ color: "#9299A6", fontSize: 12 }}>
                {visibleModels.length} models in the catalog. Model availability depends on your provider account and API access.
              </div>

              {visibleModels.length ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14 }}>
                  {visibleModels.map((item) => {
                    const itemProvider = providers.find((p) => p.id === (item.providerId || item.provider).toLowerCase());
                    const isSelected = item.id === model && (item.providerId || provider) === provider;

                    return (
                      <article key={`${item.provider}-${item.id}`} style={{ ...panelStyle, display: "grid", gap: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ color: "#A8C7FA", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>{itemProvider?.name || item.provider}</span>
                          {isSelected && <span style={{ color: "#8BC99B", fontSize: 10 }}>SELECTED</span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <Bot size={20} color="#A8C7FA" />
                          <strong style={{ color: "#ECEEF2", fontSize: 14 }}>{item.name}</strong>
                        </div>
                        <code style={{ color: "#9299A6", fontSize: 11, overflowWrap: "anywhere" }}>{item.id}</code>
                        <div style={{ color: "#9299A6", fontSize: 11 }}>
                          {item.context ? `Context: ${item.context.toLocaleString()} tokens` : "Context information not provided by catalog"}
                        </div>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            const targetProvider = (item.providerId || providers.find((p) => p.name === item.provider)?.id || provider) as ProviderId;
                            setProvider(targetProvider);
                            setModel(item.id);
                            setSection("Playground");
                            showNotice(`${item.name} selected.`);
                          }}
                        >
                          <Check size={13} /> Use this model
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div style={{ ...panelStyle, textAlign: "center", padding: 48 }}>
                  <Bot size={28} color="#9299A6" />
                  <h2 style={{ color: "#ECEEF2", fontSize: 17 }}>No models in this view</h2>
                  <p style={{ color: "#9299A6", fontSize: 13 }}>Choose a provider or refresh its catalog. The backend must return models for the selected provider.</p>
                  <button className="secondary-button" onClick={() => setModelProviderFilter("all")}>Show all providers</button>
                </div>
              )}
            </section>
          )}

          {section === "Settings" && (
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 15, alignItems: "start" }}>
              <div style={{ ...panelStyle, display: "grid", gap: 17 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#ECEEF2" }}>
                    <KeyRound size={17} /><strong>Provider API keys</strong>
                  </div>
                  <p style={{ color: "#9299A6", fontSize: 12, lineHeight: 1.6 }}>Add a key for each provider. Keys are kept in this browser tab's session storage and sent to your local backend with requests.</p>
                </div>

                {providers.map((item) => {
                  const key = apiKeys[item.id] || "";
                  const isReady = Boolean(key.trim()) || (item.id === "groq" && groqFallbackConfigured);

                  return (
                    <div key={item.id} style={{ borderTop: "1px solid #303540", paddingTop: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ color: "#ECEEF2", fontSize: 13 }}>{item.name}</strong>
                        <span style={{ color: isReady ? "#8BC99B" : "#9299A6", fontSize: 10 }}>{isReady ? "CONNECTED" : "NOT CONNECTED"}</span>
                      </div>
                      <div style={{ display: "flex", gap: 7 }}>
                        <input
                          type="password"
                          value={key}
                          autoComplete="off"
                          placeholder={item.id === "groq" && groqFallbackConfigured ? "Using server key" : `Enter ${item.name} API key`}
                          onChange={(e) => setApiKeys((current) => ({ ...current, [item.id]: e.target.value }))}
                          style={inputStyle}
                        />
                        <button style={actionButtonStyle} title="Save key" onClick={() => {
                          if (!key.trim()) {
                            showNotice("Enter an API key first.");
                            return;
                          }
                          try {
                            sessionStorage.setItem(API_KEY_PREFIX + item.id, key.trim());
                            showNotice(`${item.name} key saved for this tab.`);
                          } catch {
                            showNotice("Could not save this key in session storage.");
                          }
                        }}><Save size={14} /></button>
                        <button style={actionButtonStyle} title="Clear key" onClick={() => {
                          try { sessionStorage.removeItem(API_KEY_PREFIX + item.id); } catch { /* ignore */ }
                          setApiKeys((current) => ({ ...current, [item.id]: "" }));
                          showNotice(`${item.name} key cleared.`);
                        }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  );
                })}

                <div style={{ borderTop: "1px solid #303540", paddingTop: 12, color: "#9299A6", fontSize: 11, lineHeight: 1.6 }}>
                  <ShieldCheck size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
                  Do not use browser session storage as a production secrets vault. Anyone with access to this browser session may be able to inspect its keys.
                </div>
              </div>

              <div style={{ display: "grid", gap: 15 }}>
                <div style={{ ...panelStyle, display: "grid", gap: 15 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#ECEEF2" }}>
                    <SlidersHorizontal size={17} /><strong>Default run settings</strong>
                  </div>

                  <div>
                    <label style={smallLabelStyle}>DEFAULT PROVIDER</label>
                    <select
                      value={preferences.defaultProvider}
                      onChange={(e) => {
                        const next = e.target.value as ProviderId;
                        updatePreference("defaultProvider", next);
                        setProvider(next);
                      }}
                      style={inputStyle}
                    >
                      {providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label style={smallLabelStyle}>DEFAULT TEMPERATURE — {preferences.defaultTemperature.toFixed(1)}</label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step=".1"
                      value={preferences.defaultTemperature}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        updatePreference("defaultTemperature", value);
                        setTemperature(value);
                      }}
                      style={{ width: "100%" }}
                    />
                  </div>

                  <div>
                    <label style={smallLabelStyle}>DEFAULT MAX OUTPUT TOKENS — {preferences.defaultMaxTokens.toLocaleString()}</label>
                    <input
                      type="range"
                      min="256"
                      max="8192"
                      step="256"
                      value={preferences.defaultMaxTokens}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        updatePreference("defaultMaxTokens", value);
                        setMaxTokens(value);
                      }}
                      style={{ width: "100%" }}
                    />
                  </div>

                  <button className="secondary-button" onClick={() => {
                    setTemperature(preferences.defaultTemperature);
                    setMaxTokens(preferences.defaultMaxTokens);
                    setProvider(preferences.defaultProvider);
                    showNotice("Default settings applied.");
                  }}>
                    <Check size={14} /> Apply defaults
                  </button>
                </div>

                <div style={{ ...panelStyle, display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#ECEEF2" }}>
                    <Database size={17} /><strong>Workspace data</strong>
                  </div>
                  <p style={{ color: "#9299A6", fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                    Conversations and saved prompts are stored locally in this browser. Clearing browser site data may remove them.
                  </p>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#9299A6", fontSize: 12 }}>
                    <span>Conversations</span><strong style={{ color: "#ECEEF2" }}>{conversations.length}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#9299A6", fontSize: 12 }}>
                    <span>Saved prompts</span><strong style={{ color: "#ECEEF2" }}>{promptLibrary.length}</strong>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 9, color: "#ECEEF2", fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={preferences.saveHistory}
                      onChange={(e) => updatePreference("saveHistory", e.target.checked)}
                    />
                    Save conversation history
                  </label>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      if (!window.confirm("Delete all saved conversations? This cannot be undone.")) return;
                      setConversations([]);
                      setActiveConversationId(null);
                      showNotice("All conversation history deleted.");
                    }}
                  >
                    <Trash2 size={14} /> Clear conversation history
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      if (!window.confirm("Delete every saved prompt? This cannot be undone.")) return;
                      setPromptLibrary([]);
                      showNotice("Prompt library cleared.");
                    }}
                  >
                    <Trash2 size={14} /> Clear prompt library
                  </button>
                </div>

                <div style={{ ...panelStyle, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#ECEEF2" }}>
                    <Sparkles size={17} /><strong>About OmniPlay</strong>
                  </div>
                  <p style={{ color: "#9299A6", fontSize: 12, margin: 0 }}>AI developer workspace</p>
                  <div style={{ color: "#9299A6", fontSize: 11 }}>Build 0.4.0 · Local development</div>
                </div>
              </div>
            </section>
          )}

          <footer className="main-footer">
            <span>OMNIPLAY <span className="footer-sep">/</span> DEVELOPER WORKSPACE</span>
            <div>
              <span><span className="footer-green-dot" />LOCAL ENVIRONMENT</span>
              <span>BUILD 0.4.0</span>
              <button onClick={() => showNotice("OmniPlay API server runtime.")}><SquareTerminal size={13} /> Runtime</button>
            </div>
          </footer>
        </main>
      </div>

      <div className="bottom-runbar">
        <div className="runbar-left">
          <span className="runbar-indicator" />
          <span>{streaming ? "Generating response..." : "Ready to experiment"}</span>
          <span className="runbar-divider" />
          <span className="runbar-model">{selectedModel?.name || "No model selected"}</span>
        </div>
        <button className="run-button" onClick={() => streaming ? stopGeneration() : void runPrompt()}>
          {streaming ? <Square size={13} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          {streaming ? "Stop" : "Run"}
          <kbd>⌘ ↵</kbd>
        </button>
      </div>

      {promptEditorOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setPromptEditorOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.65)", display: "grid", placeItems: "center", padding: 18 }}
        >
          <div style={{ ...panelStyle, width: "min(560px, 100%)", maxHeight: "90vh", overflow: "auto", display: "grid", gap: 13, boxShadow: "0 20px 70px rgba(0,0,0,.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ color: "#ECEEF2", fontSize: 16 }}>{editingPromptId ? "Edit saved prompt" : "Create a prompt"}</strong>
              <button className="icon-button small" onClick={() => setPromptEditorOpen(false)}><X size={16} /></button>
            </div>
            <div>
              <label style={smallLabelStyle}>TITLE</label>
              <input value={promptTitle} onChange={(e) => setPromptTitle(e.target.value)} placeholder="e.g. React component generator" style={inputStyle} />
            </div>
            <div>
              <label style={smallLabelStyle}>CATEGORY</label>
              <input value={promptCategory} onChange={(e) => setPromptCategory(e.target.value)} placeholder="General, Coding, Writing..." style={inputStyle} />
            </div>
            <div>
              <label style={smallLabelStyle}>PROMPT CONTENT</label>
              <textarea value={promptContent} onChange={(e) => setPromptContent(e.target.value)} placeholder="Write your reusable prompt..." rows={7} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <label style={smallLabelStyle}>SYSTEM INSTRUCTIONS (OPTIONAL)</label>
              <textarea value={promptSystem} onChange={(e) => setPromptSystem(e.target.value)} placeholder="Optional system instructions..." rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="secondary-button" onClick={() => setPromptEditorOpen(false)}>Cancel</button>
              <button className="secondary-button" onClick={savePrompt}><Save size={14} /> Save prompt</button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="toast"><span className="toast-check">i</span>{notice}</div>}
    </div>
  );
}

export default App;
