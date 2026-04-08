import express from 'express';
import { sharedWorkspaceDb } from '../database/db.js';
import { addProjectManually } from '../projects.js';

const router = express.Router();

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function requireField(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const error = new Error(`${fieldName} is required`);
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
}

function toProjectName(projectPath) {
  return projectPath.replace(/[\\/:\s~_]/g, '-');
}

function resolveBindingBackfill({
  provider = 'codex',
  projectName = '',
  projectPath = '',
  sessionId = '',
}) {
  const bindings = sharedWorkspaceDb.getBindings();
  if (!Array.isArray(bindings) || bindings.length === 0) {
    return null;
  }

  const normalizedProjectName = normalizeString(projectName);
  const normalizedProjectPath = normalizeString(projectPath);
  const normalizedSessionId = normalizeString(sessionId);

  const matches = bindings.filter((binding) => {
    if (!binding || binding.provider !== provider) {
      return false;
    }

    if (normalizedSessionId && binding.sessionId === normalizedSessionId) {
      return true;
    }

    if (normalizedProjectPath && binding.projectPath === normalizedProjectPath) {
      return true;
    }

    if (normalizedProjectName && binding.projectName === normalizedProjectName) {
      return true;
    }

    return false;
  });

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return matches[0] || null;
}

async function ensureProjectIdentity(projectPath, projectName = '') {
  const trimmedPath = requireField(projectPath, 'projectPath');
  try {
    const project = await addProjectManually(trimmedPath);
    return {
      projectName: project.name,
      projectPath: project.fullPath || project.path || trimmedPath,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Project already configured')) {
      return {
        projectName: projectName || toProjectName(trimmedPath),
        projectPath: trimmedPath,
      };
    }
    throw error;
  }
}

router.get('/state', (req, res) => {
  try {
    const state = sharedWorkspaceDb.getActiveState();
    res.json({ success: true, state });
  } catch (error) {
    console.error('[shared-workspace] Failed to fetch active state:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/state', async (req, res) => {
  try {
    const projectIdentity = await ensureProjectIdentity(
      req.body.projectPath,
      normalizeString(req.body.projectName),
    );

    const provider = normalizeString(req.body.provider, 'codex');
    const bindingBackfill = resolveBindingBackfill({
      provider,
      projectName: projectIdentity.projectName,
      projectPath: projectIdentity.projectPath,
      sessionId: normalizeString(req.body.sessionId),
    });

    const state = sharedWorkspaceDb.setActiveState({
      channelType: normalizeString(req.body.channelType) || normalizeString(bindingBackfill?.channelType),
      channelId: normalizeString(req.body.channelId) || normalizeString(bindingBackfill?.channelId),
      userId: normalizeString(req.body.userId) || normalizeString(bindingBackfill?.userId),
      provider,
      projectName: projectIdentity.projectName,
      projectPath: projectIdentity.projectPath,
      sessionId: requireField(req.body.sessionId, 'sessionId'),
      sessionTitle: normalizeString(req.body.sessionTitle),
      cwd: normalizeString(req.body.cwd),
      updatedBy: normalizeString(req.body.updatedBy, 'system'),
      metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
    });

    res.json({ success: true, state });
  } catch (error) {
    console.error('[shared-workspace] Failed to update active state:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/bindings', (req, res) => {
  try {
    const bindings = sharedWorkspaceDb.getBindings();
    res.json({ success: true, bindings });
  } catch (error) {
    console.error('[shared-workspace] Failed to fetch bindings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/binding', (req, res) => {
  try {
    const channelType = requireField(req.query.channelType, 'channelType');
    const channelId = requireField(req.query.channelId, 'channelId');
    const userId = normalizeString(req.query.userId);
    const binding = sharedWorkspaceDb.getBinding(channelType, channelId, userId);
    res.json({ success: true, binding });
  } catch (error) {
    console.error('[shared-workspace] Failed to fetch binding:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.put('/binding', async (req, res) => {
  try {
    const projectIdentity = await ensureProjectIdentity(
      req.body.projectPath,
      normalizeString(req.body.projectName),
    );

    const binding = sharedWorkspaceDb.upsertBinding({
      channelType: requireField(req.body.channelType, 'channelType'),
      channelId: requireField(req.body.channelId, 'channelId'),
      userId: normalizeString(req.body.userId),
      provider: normalizeString(req.body.provider, 'codex'),
      projectName: projectIdentity.projectName,
      projectPath: projectIdentity.projectPath,
      sessionId: requireField(req.body.sessionId, 'sessionId'),
      sessionTitle: normalizeString(req.body.sessionTitle),
      cwd: normalizeString(req.body.cwd),
      updatedBy: normalizeString(req.body.updatedBy, 'system'),
      metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
    });

    const shouldActivate = req.body.activate !== false;
    const state = shouldActivate
      ? sharedWorkspaceDb.setActiveState({
          channelType: binding.channelType,
          channelId: binding.channelId,
          userId: binding.userId,
          provider: binding.provider,
          projectName: binding.projectName,
          projectPath: binding.projectPath,
          sessionId: binding.sessionId,
          sessionTitle: binding.sessionTitle,
          cwd: binding.cwd,
          updatedBy: binding.updatedBy,
          metadata: binding.metadata,
        })
      : sharedWorkspaceDb.getActiveState();

    res.json({ success: true, binding, state });
  } catch (error) {
    console.error('[shared-workspace] Failed to upsert binding:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.delete('/binding', (req, res) => {
  try {
    const channelType = requireField(req.query.channelType, 'channelType');
    const channelId = requireField(req.query.channelId, 'channelId');
    const userId = normalizeString(req.query.userId);
    const deleted = sharedWorkspaceDb.deleteBinding(channelType, channelId, userId);
    res.json({ success: true, deleted });
  } catch (error) {
    console.error('[shared-workspace] Failed to delete binding:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/continuation', async (req, res) => {
  try {
    const projectIdentity = await ensureProjectIdentity(
      req.body.projectPath,
      normalizeString(req.body.projectName),
    );

    const continuation = sharedWorkspaceDb.registerContinuation({
      provider: normalizeString(req.body.provider, 'codex'),
      projectName: projectIdentity.projectName,
      projectPath: projectIdentity.projectPath,
      rootSessionId: requireField(req.body.rootSessionId, 'rootSessionId'),
      parentSessionId: requireField(req.body.parentSessionId, 'parentSessionId'),
      sessionId: requireField(req.body.sessionId, 'sessionId'),
      sessionTitle: normalizeString(req.body.sessionTitle),
      summary: req.body.summary && typeof req.body.summary === 'object' ? req.body.summary : {},
      metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
    });

    res.json({ success: true, continuation });
  } catch (error) {
    console.error('[shared-workspace] Failed to register continuation:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/message-event', async (req, res) => {
  try {
    const activeState = sharedWorkspaceDb.getActiveState();
    const channelType = normalizeString(req.body.channelType) || normalizeString(activeState?.channelType);
    const channelId = normalizeString(req.body.channelId) || normalizeString(activeState?.channelId);
    const userId = normalizeString(req.body.userId) || normalizeString(activeState?.userId);

    if (!channelType || !channelId) {
      return res.status(400).json({
        success: false,
        error: 'No active shared workspace channel is available for mirroring',
      });
    }

    const projectIdentity = await ensureProjectIdentity(
      req.body.projectPath || activeState?.projectPath,
      normalizeString(req.body.projectName) || normalizeString(activeState?.projectName),
    );

    const event = sharedWorkspaceDb.enqueueMessageEvent({
      channelType,
      channelId,
      userId,
      provider: normalizeString(req.body.provider, normalizeString(activeState?.provider, 'codex')),
      projectName: projectIdentity.projectName,
      projectPath: projectIdentity.projectPath,
      sessionId: requireField(req.body.sessionId || activeState?.sessionId, 'sessionId'),
      sessionTitle: normalizeString(req.body.sessionTitle) || normalizeString(activeState?.sessionTitle),
      eventType: requireField(req.body.eventType, 'eventType'),
      role: normalizeString(req.body.role),
      content: normalizeString(req.body.content),
      payload: req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : {},
    });

    res.json({ success: true, event });
  } catch (error) {
    console.error('[shared-workspace] Failed to enqueue message event:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/message-events', (req, res) => {
  try {
    const channelType = requireField(req.query.channelType, 'channelType');
    const channelId = requireField(req.query.channelId, 'channelId');
    const userId = normalizeString(req.query.userId);
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));

    const events = sharedWorkspaceDb.listPendingMessageEvents({
      channelType,
      channelId,
      userId,
      limit,
    });

    res.json({ success: true, events });
  } catch (error) {
    console.error('[shared-workspace] Failed to fetch message events:', error);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/message-events/ack', (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const changes = sharedWorkspaceDb.ackMessageEvents(ids);
    res.json({ success: true, acked: changes });
  } catch (error) {
    console.error('[shared-workspace] Failed to ack message events:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
