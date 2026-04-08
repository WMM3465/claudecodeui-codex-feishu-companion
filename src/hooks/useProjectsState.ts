import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { api } from '../utils/api';
import type {
  AppSocketMessage,
  AppTab,
  LoadingProgress,
  Project,
  ProjectSession,
  ProjectsUpdatedMessage,
} from '../types/app';

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  latestMessage: AppSocketMessage | null;
  isMobile: boolean;
  activeSessions: Set<string>;
};

type FetchProjectsOptions = {
  showLoadingState?: boolean;
};

type SharedWorkspaceState = {
  provider?: string;
  projectName?: string;
  projectPath?: string;
  sessionId?: string;
  sessionTitle?: string;
  cwd?: string;
  updatedBy?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
} | null;

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const SHARED_WORKSPACE_FOLLOW_SOURCES = new Set([
  'feishu:message',
  'feishu:new',
  'feishu:bind',
  'feishu:cwd',
]);

const shouldAutoFollowSharedWorkspaceState = (
  state: SharedWorkspaceState,
  hasSelectedSession: boolean,
): boolean => {
  const updatedBy = typeof state?.updatedBy === 'string' ? state.updatedBy.trim() : '';

  if (!hasSelectedSession) {
    return true;
  }

  if (!updatedBy) {
    return false;
  }

  if (updatedBy === 'desktop' || updatedBy.startsWith('desktop:')) {
    return false;
  }

  return SHARED_WORKSPACE_FOLLOW_SOURCES.has(updatedBy);
};

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.taskmaster) !== serialize(prevProject.taskmaster);

    if (baseChanged) {
      return true;
    }

    if (!includeExternalSessions) {
      return false;
    }

    return (
      serialize(nextProject.cursorSessions) !== serialize(prevProject.cursorSessions) ||
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions) ||
      serialize(nextProject.geminiSessions) !== serialize(prevProject.geminiSessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.geminiSessions ?? []),
  ];
};

const getSessionRuntimeId = (session: ProjectSession | null | undefined): string => {
  if (!session) return '';
  const activeId = typeof session.__activeSessionId === 'string' ? session.__activeSessionId : '';
  return activeId || session.id || '';
};

const getSessionRouteId = (session: ProjectSession | null | undefined): string => {
  if (!session) return '';
  return session.id || '';
};

const getLogicalRootRouteId = (session: ProjectSession | null | undefined): string => {
  if (!session) return '';
  if (typeof session.__logicalRootSessionId === 'string' && session.__logicalRootSessionId) {
    return session.__logicalRootSessionId;
  }
  return getSessionRouteId(session);
};

const sessionMatchesState = (session: ProjectSession, sessionId: string): boolean => {
  return session.id === sessionId || getSessionRuntimeId(session) === sessionId;
};

const findSharedWorkspaceSelection = (
  projects: Project[],
  state: SharedWorkspaceState,
): { project: Project; session: ProjectSession } | null => {
  if (!state?.sessionId || !state?.projectName) {
    return null;
  }

  const stateProjectName = state.projectName;
  const stateSessionId = state.sessionId;

  const project = projects.find((item) => item.name === stateProjectName);
  if (!project) {
    return null;
  }

  const sessions = getProjectSessions(project);
  const logicalRootSessionId =
    state?.metadata && typeof state.metadata === 'object' && typeof state.metadata.logicalRootSessionId === 'string'
      ? state.metadata.logicalRootSessionId
      : '';

  const logicalRootSession =
    (logicalRootSessionId &&
      sessions.find(
        (item) => item.id === logicalRootSessionId || item.__logicalRootSessionId === logicalRootSessionId,
      )) ||
    null;

  const representativeSession =
    sessions.find(
      (item) =>
        Boolean(item.__continuationRepresentative) &&
        (item.__activeSessionId === stateSessionId ||
          (logicalRootSessionId && item.__logicalRootSessionId === logicalRootSessionId)),
    ) ||
    null;

  const runtimeMatchedSession =
    sessions.find((item) => getSessionRuntimeId(item) === stateSessionId && item.id !== stateSessionId) ||
    null;

  const exactSession =
    sessions.find((item) => item.id === stateSessionId) ||
    null;

  const session =
    representativeSession ||
    logicalRootSession ||
    runtimeMatchedSession ||
    exactSession ||
    sessions.find((item) => sessionMatchesState(item, stateSessionId));
  if (!session) {
    return null;
  }

  return { project, session };
};

const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) {
    return true;
  }

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);

  if (!currentSelectedProject || !updatedSelectedProject) {
    return false;
  }

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );

  if (!currentSelectedSession || !updatedSelectedSession) {
    return false;
  }

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};

const VALID_TABS: Set<string> = new Set(['chat', 'files', 'shell', 'git', 'tasks', 'preview']);

const isValidTab = (tab: string): tab is AppTab => {
  return VALID_TABS.has(tab) || tab.startsWith('plugin:');
};

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored && isValidTab(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  sessionId,
  navigate,
  latestMessage,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);

  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('agents');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);
  const lastSharedStateKeyRef = useRef('');

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProjects = useCallback(async ({ showLoadingState = true }: FetchProjectsOptions = {}) => {
    try {
      if (showLoadingState) {
        setIsLoadingProjects(true);
      }
      const response = await api.projects();
      const projectData = (await response.json()) as Project[];

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return projectData;
        }

        return projectsHaveChanges(prevProjects, projectData, true)
          ? projectData
          : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
      return null;
    } finally {
      if (showLoadingState) {
        setIsLoadingProjects(false);
      }
    }
  }, []);

  const fetchProjectsSnapshot = useCallback(async (): Promise<Project[]> => {
    const response = await api.projects();
    const projectData = (await response.json()) as Project[];
    return projectData;
  }, []);

  const refreshProjectsSilently = useCallback(async () => {
    // Keep chat view stable while still syncing sidebar/session metadata in background.
    const projectData = await fetchProjectsSnapshot();
    setProjects((prevProjects) =>
      projectsHaveChanges(prevProjects, projectData, true) ? projectData : prevProjects,
    );
  }, [fetchProjectsSnapshot]);

  const openSettings = useCallback((tab = 'tools') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  const applySharedWorkspaceState = useCallback(
    (state: SharedWorkspaceState, projectList: Project[] = projects) => {
      const selection = findSharedWorkspaceSelection(projectList, state);
      if (!selection) {
        return;
      }

      const nextProject = selection.project;
      const nextSession =
        selection.session.__provider
          ? selection.session
          : ({ ...selection.session, __provider: 'codex' } as ProjectSession);

      if (selectedProject?.name !== nextProject.name) {
        setSelectedProject(nextProject);
      }

      const currentRouteId = getSessionRouteId(selectedSession);
      const nextRouteId = getSessionRouteId(nextSession);
      const currentLogicalRouteId = getLogicalRootRouteId(selectedSession);
      const nextLogicalRouteId = getLogicalRootRouteId(nextSession);

      if (
        selectedSession?.id !== nextSession.id ||
        selectedSession?.__provider !== nextSession.__provider ||
        getSessionRuntimeId(selectedSession) !== getSessionRuntimeId(nextSession)
      ) {
        setSelectedSession(nextSession);
        if (
          currentRouteId !== nextRouteId &&
          currentLogicalRouteId !== nextLogicalRouteId
        ) {
          navigate(`/session/${nextRouteId}`);
        }
      }
    },
    [navigate, projects, selectedProject?.name, selectedSession?.__provider, selectedSession?.id],
  );

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (projects.length === 0) {
      return;
    }

    let cancelled = false;

    const syncSharedState = async () => {
      try {
        const response = await api.sharedWorkspace.state();
        const payload = await response.json() as { success?: boolean; state?: SharedWorkspaceState };
        if (cancelled || !payload?.success || !payload.state) {
          return;
        }

        const nextKey = JSON.stringify({
          projectName: payload.state.projectName || '',
          sessionId: payload.state.sessionId || '',
          updatedAt: payload.state.updatedAt || '',
          updatedBy: payload.state.updatedBy || '',
        });

        if (lastSharedStateKeyRef.current === nextKey) {
          return;
        }

        lastSharedStateKeyRef.current = nextKey;

        // Only explicit cross-device user actions should pull the desktop UI.
        // Result mirroring / desktop-originated writes must never steal focus.
        if (!shouldAutoFollowSharedWorkspaceState(payload.state, Boolean(selectedSession?.id))) {
          return;
        }

        const refreshedProjects = await fetchProjectsSnapshot();
        setProjects((prevProjects) =>
          projectsHaveChanges(prevProjects, refreshedProjects, true) ? refreshedProjects : prevProjects,
        );
        setExternalMessageUpdate((prev) => prev + 1);
        applySharedWorkspaceState(payload.state, refreshedProjects);
      } catch (error) {
        console.error('Error syncing shared workspace state:', error);
      }
    };

    void syncSharedState();
    const interval = window.setInterval(() => {
      void syncSharedState();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [applySharedWorkspaceState, fetchProjectsSnapshot, projects, selectedSession?.id]);

  // Auto-select the project when there is only one, so the user lands on the new session page
  useEffect(() => {
    if (!isLoadingProjects && projects.length === 1 && !selectedProject && !sessionId) {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, projects, selectedProject, sessionId]);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (latestMessage.type === 'loading_progress') {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }

      setLoadingProgress(latestMessage as LoadingProgress);

      if (latestMessage.phase === 'complete') {
        loadingProgressTimeoutRef.current = setTimeout(() => {
          setLoadingProgress(null);
          loadingProgressTimeoutRef.current = null;
        }, 500);
      }

      return;
    }

    if (latestMessage.type !== 'projects_updated') {
      return;
    }

    const projectsMessage = latestMessage as ProjectsUpdatedMessage;

    if (projectsMessage.changedFile && selectedSession && selectedProject) {
      const normalized = projectsMessage.changedFile.replace(/\\/g, '/');
      const changedFileParts = normalized.split('/');

      if (changedFileParts.length >= 2) {
        const filename = changedFileParts[changedFileParts.length - 1];
        const changedSessionId = filename.replace('.jsonl', '');

        if (sessionMatchesState(selectedSession, changedSessionId)) {
          const runtimeId = getSessionRuntimeId(selectedSession);
          const isSessionActive = activeSessions.has(runtimeId || selectedSession.id);

          if (!isSessionActive) {
            setExternalMessageUpdate((prev) => prev + 1);
          }
        }
      }
    }

    const hasActiveSession =
      (selectedSession && activeSessions.has(getSessionRuntimeId(selectedSession) || selectedSession.id)) ||
      (activeSessions.size > 0 && Array.from(activeSessions).some((id) => id.startsWith('new-session-')));

    const updatedProjects = projectsMessage.projects;

    if (
      hasActiveSession &&
      !isUpdateAdditive(projects, updatedProjects, selectedProject, selectedSession)
    ) {
      return;
    }

    setProjects(updatedProjects);

    if (!selectedProject) {
      return;
    }

    const updatedSelectedProject = updatedProjects.find(
      (project) => project.name === selectedProject.name,
    );

    if (!updatedSelectedProject) {
      return;
    }

    if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
      setSelectedProject(updatedSelectedProject);
    }

    if (!selectedSession) {
      return;
    }

    const selectedRuntimeId = getSessionRuntimeId(selectedSession);
    const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
      (session) => sessionMatchesState(session, selectedRuntimeId || selectedSession.id),
    );

    if (!updatedSelectedSession) {
      setSelectedSession(null);
    }
  }, [latestMessage, selectedProject, selectedSession, activeSessions, projects]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionId || projects.length === 0) {
      return;
    }

    for (const project of projects) {
      const claudeSession = project.sessions?.find((session) => session.id === sessionId);
      if (claudeSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'claude';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...claudeSession, __provider: 'claude' });
        }
        return;
      }

      const cursorSession = project.cursorSessions?.find((session) => session.id === sessionId);
      if (cursorSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'cursor';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...cursorSession, __provider: 'cursor' });
        }
        return;
      }

      const codexSession = project.codexSessions?.find((session) => sessionMatchesState(session, sessionId));
      if (codexSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          !sessionMatchesState(selectedSession ?? ({} as ProjectSession), sessionId) || selectedSession?.__provider !== 'codex';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...codexSession, __provider: 'codex' });
        }
        return;
      }

      const geminiSession = project.geminiSessions?.find((session) => session.id === sessionId);
      if (geminiSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'gemini';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...geminiSession, __provider: 'gemini' });
        }
        return;
      }
    }
  }, [sessionId, projects, selectedProject?.name, selectedSession?.id, selectedSession?.__provider]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      setSelectedSession(session);

      if (activeTab === 'tasks' || activeTab === 'preview') {
        setActiveTab('chat');
      }

      const provider = localStorage.getItem('selected-provider') || 'claude';
      if (provider === 'cursor') {
        sessionStorage.setItem('cursorSessionId', session.id);
      }

      if (isMobile) {
        const sessionProjectName = session.__projectName;
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);

      const sessionProjectName = session.__projectName || selectedProject?.name;
      const project = sessionProjectName
        ? projects.find((item) => item.name === sessionProjectName)
        : selectedProject;

      if (session.__provider === 'codex' && project) {
        const logicalRootSessionId =
          (typeof session.__logicalRootSessionId === 'string' && session.__logicalRootSessionId) ||
          session.id;
        void api.sharedWorkspace.setState({
          provider: 'codex',
          projectName: project.name,
          projectPath: project.fullPath || project.path || '',
          sessionId: getSessionRuntimeId(session) || session.id,
          sessionTitle: session.summary || session.title || session.name || 'Codex Session',
          cwd: project.fullPath || project.path || '',
          updatedBy: 'desktop',
          metadata: {
            source: 'cloudcli',
            workspaceKind: 'shared',
            logicalRootSessionId,
          },
        });
      }
    },
    [activeTab, isMobile, navigate, projects, selectedProject, selectedProject?.name],
  );

  const handleNewSession = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          sessions: project.sessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );
    },
    [navigate, selectedSession?.id],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const response = await api.projects();
      const freshProjects = (await response.json()) as Project[];

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, freshProjects, true) ? freshProjects : prevProjects,
      );

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => sessionMatchesState(session, getSessionRuntimeId(selectedSession) || selectedSession.id),
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [selectedProject, selectedSession]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      handleNewSession,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleSidebarRefresh,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      projects,
      settingsInitialTab,
      selectedProject,
      selectedSession,
      showSettings,
    ],
  );

  return {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    refreshProjectsSilently,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
  };
}
