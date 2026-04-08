import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { api } from '../../../utils/api';
import type { PendingPermissionRequest } from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

const HIDDEN_SESSIONS_STORAGE_KEY = 'cloudcli-hidden-sessions-by-project';

function hideSessionInProject(projectName: string, sessionId: string) {
  if (!projectName || !sessionId || typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(HIDDEN_SESSIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, string[]> : {};
    const current = Array.isArray(parsed[projectName]) ? parsed[projectName] : [];
    if (!current.includes(sessionId)) {
      parsed[projectName] = [...current, sessionId];
      localStorage.setItem(HIDDEN_SESSIONS_STORAGE_KEY, JSON.stringify(parsed));
      window.dispatchEvent(new CustomEvent('cloudcli:hidden-sessions-updated'));
    }
  } catch (error) {
    console.warn('Failed to hide continued session:', error);
  }
}

function unhideSessionInProject(projectName: string, sessionId: string) {
  if (!projectName || !sessionId || typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(HIDDEN_SESSIONS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const current = Array.isArray(parsed[projectName]) ? parsed[projectName] : [];
    const next = current.filter((value) => value !== sessionId);
    if (next.length !== current.length) {
      if (next.length === 0) {
        delete parsed[projectName];
      } else {
        parsed[projectName] = next;
      }
      localStorage.setItem(HIDDEN_SESSIONS_STORAGE_KEY, JSON.stringify(parsed));
      window.dispatchEvent(new CustomEvent('cloudcli:hidden-sessions-updated'));
    }
  } catch (error) {
    console.warn('Failed to unhide continued session:', error);
  }
}

type LatestChatMessage = {
  type?: string;
  kind?: string;
  data?: any;
  message?: any;
  delta?: string;
  sessionId?: string;
  session_id?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: any;
  toolId?: string;
  result?: any;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  event?: string;
  status?: any;
  isNewSession?: boolean;
  resultText?: string;
  isError?: boolean;
  success?: boolean;
  reason?: string;
  provider?: string;
  content?: string;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  tokenBudget?: unknown;
  newSessionId?: string;
  aborted?: boolean;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  accumulatedStreamRef: MutableRefObject<string>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onReplaceProcessingSession?: (previousSessionId?: string | null, nextSessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (sessionId: string) => void;
  onWebSocketReconnect?: () => void;
  sessionStore: SessionStore;
  continuationPendingRef: MutableRefObject<{
    rootSessionId: string;
    parentSessionId: string;
    projectName: string;
    projectPath: string;
    sessionTitle: string;
    summary: { summaryText?: string };
    metadata: Record<string, unknown>;
  } | null>;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatRealtimeHandlers({
  latestMessage,
  provider,
  selectedProject,
  selectedSession,
  currentSessionId,
  setCurrentSessionId,
  setIsLoading,
  setCanAbortSession,
  setClaudeStatus,
  setTokenBudget,
  setPendingPermissionRequests,
  pendingViewSessionRef,
  streamBufferRef,
  streamTimerRef,
  accumulatedStreamRef,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onReplaceProcessingSession,
  onReplaceTemporarySession,
  onNavigateToSession,
  onWebSocketReconnect,
  sessionStore,
  continuationPendingRef,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);
  const lastMirroredAssistantMessageIdsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!latestMessage) return;
    if (lastProcessedMessageRef.current === latestMessage) return;
    lastProcessedMessageRef.current = latestMessage;

    const msg = latestMessage as any;
    const selectedRootSessionId = selectedSession?.id || null;
    const selectedRuntimeSessionId =
      (typeof selectedSession?.__activeSessionId === 'string' && selectedSession.__activeSessionId) ||
      selectedSession?.id ||
      null;
    const incomingSessionId =
      msg.sessionId || msg.session_id || msg.actualSessionId || pendingViewSessionRef.current?.sessionId || null;
    const activeViewSessionId =
      selectedRuntimeSessionId ||
      currentSessionId ||
      pendingViewSessionRef.current?.sessionId ||
      null;
    const shouldProjectCodexRuntimeOntoRoot =
      provider === 'codex' &&
      Boolean(selectedRootSessionId) &&
      Boolean(
        (incomingSessionId && incomingSessionId === selectedRuntimeSessionId) ||
        (incomingSessionId && incomingSessionId === pendingViewSessionRef.current?.sessionId),
      );
    const displaySessionId =
      (shouldProjectCodexRuntimeOntoRoot ? selectedRootSessionId : null) ||
      incomingSessionId ||
      activeViewSessionId;

    /* ---------------------------------------------------------------- */
    /*  Legacy messages (no `kind` field) 鈥?handle and return           */
    /* ---------------------------------------------------------------- */

    if (!msg.kind) {
      const messageType = String(msg.type || '');

      switch (messageType) {
        case 'websocket-reconnected':
          onWebSocketReconnect?.();
          return;

        case 'pending-permissions-response': {
          const permSessionId = incomingSessionId;
          const preferredCurrentSessionId =
            selectedRuntimeSessionId ||
            currentSessionId ||
            selectedRootSessionId;
          const isCurrentPermSession =
            Boolean(permSessionId) &&
            Boolean(preferredCurrentSessionId) &&
            permSessionId === preferredCurrentSessionId;
          if (permSessionId && !isCurrentPermSession) return;
          setPendingPermissionRequests(msg.data || []);
          return;
        }

        case 'session-status': {
          const statusSessionId = incomingSessionId;
          if (!statusSessionId) return;

          const status = msg.status;
          if (status) {
            const statusInfo = {
              text: status.text || 'Working...',
              tokens: status.tokens || 0,
              can_interrupt: status.can_interrupt !== undefined ? status.can_interrupt : true,
            };
            setClaudeStatus(statusInfo);
            setIsLoading(true);
            setCanAbortSession(statusInfo.can_interrupt);
            return;
          }

          // Legacy isProcessing format from check-session-status
          const preferredCurrentSessionId =
            selectedRuntimeSessionId ||
            currentSessionId ||
            selectedRootSessionId;
          const isCurrentSession =
            Boolean(statusSessionId) &&
            Boolean(preferredCurrentSessionId) &&
            statusSessionId === preferredCurrentSessionId;

          if (msg.isProcessing) {
            onSessionProcessing?.(statusSessionId);
            if (isCurrentSession) { setIsLoading(true); setCanAbortSession(true); }
            return;
          }
          onSessionInactive?.(statusSessionId);
          onSessionNotProcessing?.(statusSessionId);
          if (isCurrentSession) {
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);
          }
          return;
        }

        default:
          // Unknown legacy message type 鈥?ignore
          return;
      }
    }

    /* ---------------------------------------------------------------- */
    /*  NormalizedMessage handling (has `kind` field)                    */
    /* ---------------------------------------------------------------- */

    const sid = incomingSessionId || activeViewSessionId;

    // --- Streaming: buffer for performance ---
    if (msg.kind === 'stream_delta') {
      const text = msg.content || '';
      if (!text) return;
      streamBufferRef.current += text;
      accumulatedStreamRef.current += text;
      if (!streamTimerRef.current) {
        streamTimerRef.current = window.setTimeout(() => {
          streamTimerRef.current = null;
          if (displaySessionId) {
            sessionStore.updateStreaming(displaySessionId, accumulatedStreamRef.current, provider);
          }
        }, 100);
      }
      return;
    }

    if (msg.kind === 'stream_end') {
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      if (displaySessionId) {
        if (accumulatedStreamRef.current) {
          sessionStore.updateStreaming(displaySessionId, accumulatedStreamRef.current, provider);
        }
        sessionStore.finalizeStreaming(displaySessionId);
      }
      accumulatedStreamRef.current = '';
      streamBufferRef.current = '';
      return;
    }

    // --- All other messages: route to store ---
    if (displaySessionId && msg.kind !== 'session_created') {
      sessionStore.appendRealtime(displaySessionId, msg as NormalizedMessage);
    }

    // --- UI side effects for specific kinds ---
    switch (msg.kind) {
      case 'session_created': {
        const newSessionId = msg.newSessionId;
        if (!newSessionId) break;

        const pendingContinuation = continuationPendingRef.current;
        if (pendingContinuation && provider === 'codex') {
          const rootSessionId = pendingContinuation.rootSessionId;
          const parentSessionId = pendingContinuation.parentSessionId;
          const projectName = selectedProject?.name || pendingContinuation.projectName;
          const projectPath =
            selectedProject?.fullPath ||
            selectedProject?.path ||
            pendingContinuation.projectPath;
          const visibleSessionId = rootSessionId;

          setTokenBudget(null);
          setCurrentSessionId(newSessionId);
          pendingViewSessionRef.current = { sessionId: newSessionId, startedAt: Date.now() };
          onReplaceProcessingSession?.(parentSessionId, newSessionId);
          onSessionNotProcessing?.(rootSessionId);

          sessionStore.appendRealtime(visibleSessionId, {
            id: `${visibleSessionId}_continuation_summary_${newSessionId}`,
            kind: 'task_notification',
            status: 'completed',
            summary: '压缩上下文摘要',
            content: '压缩上下文摘要',
            continuationSummary: String(pendingContinuation.summary?.summaryText || ''),
            isContinuationSummary: true,
            sessionId: visibleSessionId,
            provider: 'codex',
            timestamp: new Date().toISOString(),
          } as NormalizedMessage);

          unhideSessionInProject(projectName, rootSessionId);
          hideSessionInProject(projectName, newSessionId);
          if (parentSessionId && parentSessionId !== rootSessionId) {
            hideSessionInProject(projectName, parentSessionId);
          }

          void api.sharedWorkspace.registerContinuation({
            provider: 'codex',
            projectName: pendingContinuation.projectName,
            projectPath: pendingContinuation.projectPath,
            rootSessionId: pendingContinuation.rootSessionId,
            parentSessionId: pendingContinuation.parentSessionId,
            sessionId: newSessionId,
            sessionTitle: pendingContinuation.sessionTitle,
            summary: {
              summaryText: String(pendingContinuation.summary?.summaryText || ''),
              label: '压缩上下文摘要',
            },
            metadata: pendingContinuation.metadata,
          })
            .then(() => api.sharedWorkspace.setState({
              provider: 'codex',
              projectName: pendingContinuation.projectName,
              projectPath: pendingContinuation.projectPath,
              sessionId: newSessionId,
              sessionTitle: pendingContinuation.sessionTitle,
              cwd: pendingContinuation.projectPath,
              updatedBy: 'desktop',
              metadata: {
                ...pendingContinuation.metadata,
                logicalRootSessionId: pendingContinuation.rootSessionId,
              },
            }))
              .then(async () => {
                window.refreshProjects?.();

                if (projectName && projectPath) {
                  const refreshArgs = {
                    provider: 'codex',
                    projectName,
                    projectPath,
                  } as const;
                  await sessionStore.refreshFromServer(rootSessionId, refreshArgs);
                }
              })
            .catch((error) => {
              console.error('Failed to register continuation session:', error);
            });
          continuationPendingRef.current = null;
          break;
        }

        if (!currentSessionId || currentSessionId.startsWith('new-session-')) {
          sessionStorage.setItem('pendingSessionId', newSessionId);
          if (pendingViewSessionRef.current && !pendingViewSessionRef.current.sessionId) {
            pendingViewSessionRef.current.sessionId = newSessionId;
          }
          setCurrentSessionId(newSessionId);
          onReplaceTemporarySession?.(newSessionId);
          setPendingPermissionRequests((prev) =>
            prev.map((r) => (r.sessionId ? r : { ...r, sessionId: newSessionId })),
          );
        }
        if (!selectedSession?.id) {
          onNavigateToSession?.(newSessionId);
        }
        break;
      }

      case 'complete': {
        // Flush any remaining streaming state
        if (streamTimerRef.current) {
          clearTimeout(streamTimerRef.current);
          streamTimerRef.current = null;
        }
        if (sid && accumulatedStreamRef.current) {
          sessionStore.updateStreaming(sid, accumulatedStreamRef.current, provider);
          sessionStore.finalizeStreaming(sid);
        }
        accumulatedStreamRef.current = '';
        streamBufferRef.current = '';

        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        setPendingPermissionRequests([]);
        onSessionInactive?.(sid);
        onSessionNotProcessing?.(sid);

        // Handle aborted case
        if (msg.aborted) {
          // Abort was requested 鈥?the complete event confirms it
          // No special UI action needed beyond clearing loading state above
          // The backend already sent any abort-related messages
          break;
        }

        if (
          provider === 'codex' &&
          selectedProject &&
          displaySessionId
        ) {
          const mergedMessages = sessionStore.getMessages(displaySessionId);
          const latestAssistantMessage = [...mergedMessages]
            .reverse()
            .find((entry) =>
              entry.kind === 'text' &&
              entry.role === 'assistant' &&
              typeof entry.content === 'string' &&
              entry.content.trim(),
            );

          if (latestAssistantMessage?.id) {
            const previouslyMirroredId = lastMirroredAssistantMessageIdsRef.current.get(displaySessionId);
            if (previouslyMirroredId !== latestAssistantMessage.id) {
              lastMirroredAssistantMessageIdsRef.current.set(displaySessionId, latestAssistantMessage.id);
              void api.sharedWorkspace.createMessageEvent({
                provider: 'codex',
                projectName: selectedProject.name,
                projectPath: selectedProject.fullPath || selectedProject.path || '',
                sessionId: displaySessionId,
                sessionTitle:
                  selectedSession?.summary ||
                  selectedSession?.title ||
                  selectedSession?.name ||
                  '共享线程',
                eventType: 'chat_message',
                role: 'assistant',
                content: latestAssistantMessage.content || '',
                payload: {
                  source: 'desktop',
                  kind: 'assistant_reply_final',
                  messageId: latestAssistantMessage.id,
                  logicalRootSessionId:
                    (typeof selectedSession?.__logicalRootSessionId === 'string' && selectedSession.__logicalRootSessionId) ||
                    selectedSession?.id ||
                    displaySessionId,
                },
              }).catch((error) => {
                console.error('Failed to mirror final desktop assistant message to shared workspace:', error);
              });
            }
          }
        }

        // Clear pending session
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        if (pendingSessionId && !currentSessionId && msg.exitCode === 0) {
          const actualId = msg.actualSessionId || pendingSessionId;
          setCurrentSessionId(actualId);
          if (msg.actualSessionId) {
            onNavigateToSession?.(actualId);
          }
          sessionStorage.removeItem('pendingSessionId');
          if (window.refreshProjects) {
            setTimeout(() => window.refreshProjects?.(), 500);
          }
        }
        break;
      }

      case 'error': {
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        onSessionInactive?.(sid);
        onSessionNotProcessing?.(sid);
        break;
      }

      case 'permission_request': {
        if (!msg.requestId) break;
        setPendingPermissionRequests((prev) => {
          if (prev.some((r: PendingPermissionRequest) => r.requestId === msg.requestId)) return prev;
          return [...prev, {
            requestId: msg.requestId,
            toolName: msg.toolName || 'UnknownTool',
            input: msg.input,
            context: msg.context,
            sessionId: sid || null,
            receivedAt: new Date(),
          }];
        });
        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({ text: 'Waiting for permission', tokens: 0, can_interrupt: true });
        break;
      }

      case 'permission_cancelled': {
        if (msg.requestId) {
          setPendingPermissionRequests((prev) => prev.filter((r: PendingPermissionRequest) => r.requestId !== msg.requestId));
        }
        break;
      }

      case 'status': {
        if (msg.text === 'token_budget' && msg.tokenBudget) {
          const budgetSessionId =
            incomingSessionId ||
            currentSessionId ||
            pendingViewSessionRef.current?.sessionId ||
            null;
          const isActiveBudget =
            !budgetSessionId ||
            budgetSessionId === currentSessionId ||
            budgetSessionId === selectedRuntimeSessionId ||
            budgetSessionId === pendingViewSessionRef.current?.sessionId;
          if (isActiveBudget) {
            setTokenBudget(msg.tokenBudget as Record<string, unknown>);
          }
        } else if (msg.text) {
          setClaudeStatus({
            text: msg.text,
            tokens: msg.tokens || 0,
            can_interrupt: msg.canInterrupt !== undefined ? msg.canInterrupt : true,
          });
          setIsLoading(true);
          setCanAbortSession(msg.canInterrupt !== false);
        }
        break;
      }

      // text, tool_use, tool_result, thinking, interactive_prompt, task_notification
      // 鈫?already routed to store above, no UI side effects needed
      default:
        break;
    }
  }, [
    latestMessage,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setPendingPermissionRequests,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    accumulatedStreamRef,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceProcessingSession,
    onReplaceTemporarySession,
    onNavigateToSession,
    onWebSocketReconnect,
    sessionStore,
    continuationPendingRef,
  ]);
}

