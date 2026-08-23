import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Play, Square, Trash2 } from "lucide-react";

import { dbDetailRoute } from "@/router";

import { Button } from "@shared/components/button";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import { StatusBadge } from "@shared/components/status-badge";

import {
  BackupsTab,
  ConnectionTab,
  LogsTab,
  MonitoringTab,
} from "@database/infrastructure/ui/components";

import { useDatabaseActions } from "@database/infrastructure/ui/hooks/useDatabaseActions";
import { useDatabaseDetail } from "@database/infrastructure/ui/hooks/useDatabaseDetail";

import { useAuthStore } from "@lib/auth";
import { cn } from "@lib/utils";

import {
  DB_TYPE_EMOJI,
  TABS,
} from "@database/infrastructure/ui/constants/database.constants";

import type { TabT } from "@database/infrastructure/ui/interfaces/database.interfaces";

export const DatabaseDetailPage: React.FC = () => {
  const { projectId, dbId: databaseId } = dbDetailRoute.useParams();
  const navigate = useNavigate();
  const onBack = () =>
    navigate({ to: "/projects/$projectId", params: { projectId } });
  const [activeTab, setActiveTab] = useState<TabT>("connection");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const canWrite = useAuthStore((s) => s.canWrite)();
  const isAdmin = useAuthStore((s) => s.isAdmin)();

  const { db, isLoading } = useDatabaseDetail(databaseId);

  const { start, stop, remove } = useDatabaseActions(databaseId, onBack);

  if (isLoading)
    return <div className="text-sm text-text-muted p-6">Loading...</div>;
  if (!db)
    return <div className="text-sm text-danger p-6">Database not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-xl">{DB_TYPE_EMOJI[db.type] ?? "💾"}</span>
            <h1 className="text-xl font-semibold">{db.name}</h1>
            <StatusBadge status={db.status} />
          </div>
          <p className="text-xs text-text-muted mt-0.5 font-mono">
            {db.type} {db.version && `v${db.version}`} · port {db.internalPort}
            {db.replicaSet && " · replica-set"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canWrite &&
            (db.status === "running" ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => stop.mutate({ id: databaseId })}
                disabled={stop.isPending}
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => start.mutate({ id: databaseId })}
                disabled={start.isPending}
              >
                <Play className="w-3.5 h-3.5" />
                Start
              </Button>
            ))}
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              title="Delete database"
            >
              <Trash2 className="w-3.5 h-3.5 text-danger" />
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-px overflow-x-auto scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm rounded-t-lg transition-colors relative shrink-0",
              activeTab === tab.id
                ? "text-text-primary bg-surface-1"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "connection" && <ConnectionTab db={db} />}
      {activeTab === "backups" && (
        <BackupsTab db={db} databaseId={databaseId} />
      )}
      {activeTab === "monitoring" && (
        <MonitoringTab db={db} databaseId={databaseId} />
      )}
      {activeTab === "logs" && <LogsTab db={db} />}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => remove.mutate({ id: databaseId })}
        title="Delete Database"
        description={`This will permanently delete "${db.name}" and destroy its container and data. This action cannot be undone.`}
        confirmText="Delete Database"
        isPending={remove.isPending}
      />
    </div>
  );
};
