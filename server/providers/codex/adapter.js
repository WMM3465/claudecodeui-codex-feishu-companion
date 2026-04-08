/**
 * Codex (OpenAI) provider adapter.
 *
 * Normalizes Codex SDK session history into NormalizedMessage format.
 * @module adapters/codex
 */

import { getCodexSessionMessages } from '../../projects.js';
import { createNormalizedMessage, generateMessageId } from '../types.js';
import { sharedWorkspaceDb } from '../../database/db.js';

const PROVIDER = 'codex';

function parseContinuationWrappedUserContent(content) {
  if (typeof content !== 'string') {
    return null;
  }
  const modernMatch = content.match(
    /<context_summary>\s*([\s\S]*?)\s*<\/context_summary>[\s\S]*?<new_request>\s*([\s\S]*?)\s*<\/new_request>/i,
  );
  const legacyMatch = content.match(
    /<氓沤鈥姑悸┟ㄆ捙捗︹劉炉>\s*([\s\S]*?)\s*<\/氓沤鈥姑悸┟ㄆ捙捗︹劉炉>[\s\S]*?<忙鈥撀懊♀€灻访β扁€?\s*([\s\S]*?)\s*<\/忙鈥撀懊♀€灻访β扁€?/,
  );
  const match = modernMatch || legacyMatch;
  if (!match) {
    return null;
  }
  const summary = String(match[1] || '').trim();
  const userRequest = String(match[2] || '').trim();
  if (!summary || !userRequest) {
    return null;
  }
  return {
    summary,
    userRequest,
  };
}

/**
 * Normalize a raw Codex JSONL message into NormalizedMessage(s).
 * @param {object} raw - A single parsed message from Codex JSONL
 * @param {string} sessionId
 * @returns {import('../types.js').NormalizedMessage[]}
 */
function normalizeCodexHistoryEntry(raw, sessionId) {
  const ts = raw.timestamp || new Date().toISOString();
  const baseId = raw.uuid || generateMessageId('codex');

  // User message
  if (raw.message?.role === 'user') {
    const content = typeof raw.message.content === 'string'
      ? raw.message.content
      : Array.isArray(raw.message.content)
        ? raw.message.content.map(p => typeof p === 'string' ? p : p?.text || '').filter(Boolean).join('\n')
        : String(raw.message.content || '');
    if (!content.trim()) return [];
    const continuationPayload = parseContinuationWrappedUserContent(content);
    if (continuationPayload) {
      return [
        createNormalizedMessage({
          id: `${baseId}_continuation_summary`,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'task_notification',
          status: 'completed',
          summary: '压缩上下文摘要',
          continuationSummary: continuationPayload.summary,
          isContinuationSummary: true,
        }),
        createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp: ts,
          provider: PROVIDER,
          kind: 'text',
          role: 'user',
          content: continuationPayload.userRequest,
        }),
      ];
    }
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'text',
      role: 'user',
      content,
    })];
  }

  // Assistant message
  if (raw.message?.role === 'assistant') {
    const content = typeof raw.message.content === 'string'
      ? raw.message.content
      : Array.isArray(raw.message.content)
        ? raw.message.content.map(p => typeof p === 'string' ? p : p?.text || '').filter(Boolean).join('\n')
        : '';
    if (!content.trim()) return [];
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'text',
      role: 'assistant',
      content,
    })];
  }

  // Thinking/reasoning
  if (raw.type === 'thinking' || raw.isReasoning) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'thinking',
      content: raw.message?.content || '',
    })];
  }

  // Tool use
  if (raw.type === 'tool_use' || raw.toolName) {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'tool_use',
      toolName: raw.toolName || 'Unknown',
      toolInput: raw.toolInput,
      toolId: raw.toolCallId || baseId,
    })];
  }

  // Tool result
  if (raw.type === 'tool_result') {
    return [createNormalizedMessage({
      id: baseId,
      sessionId,
      timestamp: ts,
      provider: PROVIDER,
      kind: 'tool_result',
      toolId: raw.toolCallId || '',
      content: raw.output || '',
      isError: Boolean(raw.isError),
    })];
  }

  return [];
}

/**
 * Normalize a raw Codex event (history JSONL or transformed SDK event) into NormalizedMessage(s).
 * @param {object} raw - A history entry (has raw.message.role) or transformed SDK event (has raw.type)
 * @param {string} sessionId
 * @returns {import('../types.js').NormalizedMessage[]}
 */
export function normalizeMessage(raw, sessionId) {
  // History format: has message.role
  if (raw.message?.role) {
    return normalizeCodexHistoryEntry(raw, sessionId);
  }

  const ts = raw.timestamp || new Date().toISOString();
  const baseId = raw.uuid || generateMessageId('codex');

  // SDK event format (output of transformCodexEvent)
  if (raw.type === 'item') {
    switch (raw.itemType) {
      case 'agent_message':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'text', role: 'assistant', content: raw.message?.content || '',
        })];
      case 'reasoning':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'thinking', content: raw.message?.content || '',
        })];
      case 'command_execution':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: 'Bash', toolInput: { command: raw.command },
          toolId: baseId,
          output: raw.output, exitCode: raw.exitCode, status: raw.status,
        })];
      case 'file_change':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: 'FileChanges', toolInput: raw.changes,
          toolId: baseId, status: raw.status,
        })];
      case 'mcp_tool_call':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: raw.tool || 'MCP', toolInput: raw.arguments,
          toolId: baseId, server: raw.server, result: raw.result,
          error: raw.error, status: raw.status,
        })];
      case 'web_search':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: 'WebSearch', toolInput: { query: raw.query },
          toolId: baseId,
        })];
      case 'todo_list':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: 'TodoList', toolInput: { items: raw.items },
          toolId: baseId,
        })];
      case 'error':
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'error', content: raw.message?.content || 'Unknown error',
        })];
      default:
        // Unknown item type — pass through as generic tool_use
        return [createNormalizedMessage({
          id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
          kind: 'tool_use', toolName: raw.itemType || 'Unknown',
          toolInput: raw.item || raw, toolId: baseId,
        })];
    }
  }

  if (raw.type === 'turn_complete') {
    return [createNormalizedMessage({
      id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
      kind: 'complete',
    })];
  }
  if (raw.type === 'turn_failed') {
    return [createNormalizedMessage({
      id: baseId, sessionId, timestamp: ts, provider: PROVIDER,
      kind: 'error', content: raw.error?.message || 'Turn failed',
    })];
  }

  return [];
}

/**
 * @type {import('../types.js').ProviderAdapter}
 */
export const codexAdapter = {
  normalizeMessage,
  /**
   * Fetch session history from Codex JSONL files.
   */
  async fetchHistory(sessionId, opts = {}) {
    const { limit = null, offset = 0 } = opts;

    const continuationChain = sharedWorkspaceDb.getContinuationChain(sessionId, PROVIDER);
    const sessionIdsToLoad = continuationChain?.chainSessionIds?.length
      ? continuationChain.chainSessionIds
      : [sessionId];

    const normalized = [];
    const tokenUsageBySession = new Map();

    for (let index = 0; index < sessionIdsToLoad.length; index += 1) {
      const segmentSessionId = sessionIdsToLoad[index];
      let result;
      try {
        result = await getCodexSessionMessages(segmentSessionId, null, 0);
      } catch (error) {
        console.warn(`[CodexAdapter] Failed to load session ${segmentSessionId}:`, error.message);
        continue;
      }

      const rawMessages = Array.isArray(result) ? result : (result.messages || []);
      for (const raw of rawMessages) {
        const entries = normalizeCodexHistoryEntry(raw, sessionId);
        normalized.push(...entries);
      }

      if (result?.tokenUsage) {
        tokenUsageBySession.set(segmentSessionId, result.tokenUsage);
      }
    }

    let tokenUsage = null;
    if (continuationChain?.activeSessionId) {
      tokenUsage = tokenUsageBySession.get(continuationChain.activeSessionId) || null;
      // If the active continuation session has not reported a budget yet,
      // prefer hiding the stale root 100% meter instead of showing an
      // obviously wrong value from the previous segment.
      if (!tokenUsage && continuationChain.activeSessionId !== sessionId) {
        tokenUsage = null;
      }
    }

    const shouldFallbackToPreviousBudget =
      !continuationChain?.activeSessionId || continuationChain.activeSessionId === sessionId;

    if (!tokenUsage && shouldFallbackToPreviousBudget) {
      for (let index = sessionIdsToLoad.length - 1; index >= 0; index -= 1) {
        const candidate = tokenUsageBySession.get(sessionIdsToLoad[index]);
        if (candidate) {
          tokenUsage = candidate;
          break;
        }
      }
    }

    normalized.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    const total = normalized.length;
    const startIndex = limit !== null ? Math.max(0, total - offset - limit) : 0;
    const endIndex = limit !== null ? total - offset : total;
    const paginated = normalized.slice(startIndex, endIndex);
    const hasMore = limit !== null ? startIndex > 0 : false;

    // Attach tool results to tool_use messages
    const toolResultMap = new Map();
    for (const msg of paginated) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of paginated) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const tr = toolResultMap.get(msg.toolId);
        msg.toolResult = { content: tr.content, isError: tr.isError };
      }
    }

    return {
      messages: paginated,
      total,
      hasMore,
      offset,
      limit,
      tokenUsage,
    };
  },
};

