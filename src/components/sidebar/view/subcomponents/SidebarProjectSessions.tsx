import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import type React from 'react';
import { useState } from 'react';
import { Button } from '../../../../shared/view/ui';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import SidebarSessionItem from './SidebarSessionItem';

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  hiddenSessionIds: string[];
  isHiddenSectionExpanded: boolean;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  onHideSession: (projectName: string, sessionId: string) => void;
  onUnhideSession: (projectName: string, sessionId: string) => void;
  onToggleHiddenSection: (projectName: string) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  t: TFunction;
};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md p-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function SidebarProjectSessions({
  project,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  isLoadingSessions,
  currentTime,
  editingSession,
  editingSessionName,
  hiddenSessionIds,
  isHiddenSectionExpanded,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onHideSession,
  onUnhideSession,
  onToggleHiddenSection,
  onLoadMoreSessions,
  onNewSession,
  t,
}: SidebarProjectSessionsProps) {
  if (!isExpanded) {
    return null;
  }

  const hiddenSet = new Set(hiddenSessionIds);
  const visibleSessions = sessions.filter((session) => !hiddenSet.has(session.id));
  const hiddenSessions = sessions.filter((session) => hiddenSet.has(session.id));
  const hasVisibleSessions = visibleSessions.length > 0;
  const hasAnySessions = visibleSessions.length > 0 || hiddenSessions.length > 0;
  const hasMoreSessions = project.sessionMeta?.hasMore === true;
  const [isDragOverHidden, setIsDragOverHidden] = useState(false);

  const handleHiddenDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOverHidden(false);
    const raw = event.dataTransfer.getData('application/x-cloudcli-session');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as { projectName?: string; sessionId?: string };
      if (payload.projectName !== project.name || !payload.sessionId) return;
      onHideSession(project.name, payload.sessionId);
    } catch {
      // Ignore malformed drag payloads
    }
  };

  return (
    <div className="ml-3 space-y-1 border-l border-border pl-3">
      <div className="px-3 pb-1 pt-1 md:hidden">
        <button
          className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
          onClick={() => {
            onProjectSelect(project);
            onNewSession(project);
          }}
        >
          <Plus className="h-3 w-3" />
          {t('sessions.newSession')}
        </button>
      </div>

      <Button
        variant="default"
        size="sm"
        className="hidden h-8 w-full justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:flex"
        onClick={() => onNewSession(project)}
      >
        <Plus className="h-3 w-3" />
        {t('sessions.newSession')}
      </Button>

      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasAnySessions && !isLoadingSessions ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        visibleSessions.map((session) => (
          <SidebarSessionItem
            key={session.id}
            project={project}
            session={session}
            isHidden={false}
            selectedSession={selectedSession}
            currentTime={currentTime}
            editingSession={editingSession}
            editingSessionName={editingSessionName}
            onEditingSessionNameChange={onEditingSessionNameChange}
            onStartEditingSession={onStartEditingSession}
            onCancelEditingSession={onCancelEditingSession}
            onSaveEditingSession={onSaveEditingSession}
            onProjectSelect={onProjectSelect}
            onSessionSelect={onSessionSelect}
            onDeleteSession={onDeleteSession}
            onToggleHiddenSession={onHideSession}
            onDragStartSession={() => {
              if (!isHiddenSectionExpanded) {
                onToggleHiddenSection(project.name);
              }
            }}
            t={t}
          />
        ))
      )}

      <div
        className={`mt-2 space-y-1 rounded-md border p-2 transition-colors ${
          isDragOverHidden
            ? 'border-primary/60 bg-primary/10'
            : 'border-border/60 bg-muted/10'
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setIsDragOverHidden(true);
        }}
        onDragLeave={() => setIsDragOverHidden(false)}
        onDrop={handleHiddenDrop}
      >
          <button
            className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            onClick={() => onToggleHiddenSection(project.name)}
          >
            <span>{t('sessions.hiddenSessions')}</span>
            <div className="flex items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {hiddenSessions.length}
              </span>
              {isHiddenSectionExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </div>
          </button>

          {isHiddenSectionExpanded && (
            <div className="space-y-1 border-l border-border pl-2">
              {hiddenSessions.length === 0 && (
                <div className="rounded-md px-2 py-2 text-[11px] text-muted-foreground/80">
                  {t('sessions.hiddenSessionsEmpty')}
                </div>
              )}
              {hiddenSessions.map((session) => (
                <SidebarSessionItem
                  key={session.id}
                  project={project}
                  session={session}
                  isHidden
                  selectedSession={selectedSession}
                  currentTime={currentTime}
                  editingSession={editingSession}
                  editingSessionName={editingSessionName}
                  onEditingSessionNameChange={onEditingSessionNameChange}
                  onStartEditingSession={onStartEditingSession}
                  onCancelEditingSession={onCancelEditingSession}
                  onSaveEditingSession={onSaveEditingSession}
                  onProjectSelect={onProjectSelect}
                  onSessionSelect={onSessionSelect}
                  onDeleteSession={onDeleteSession}
                  onToggleHiddenSession={onUnhideSession}
                  t={t}
                />
              ))}
            </div>
          )}
      </div>

      {hasVisibleSessions && hasMoreSessions && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full justify-center gap-2 text-muted-foreground"
          onClick={() => onLoadMoreSessions(project)}
          disabled={isLoadingSessions}
        >
          {isLoadingSessions ? (
            <>
              <div className="h-3 w-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
              {t('sessions.loading')}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              {t('sessions.showMore')}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
