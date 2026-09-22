import { memo, useEffect, useRef } from "react";

import { Modal } from "@shared/components/modal";

import { useTaskRun } from "@task/infrastructure/ui/hooks/useTaskRun";

import { cn } from "@lib/utils";

import { STATUS_STYLES } from "@task/infrastructure/ui/constants/task.constants";

interface RunOutputDialogPropsI {
  runId: string | null;
  command?: string;
  onClose: () => void;
}

export const RunOutputDialog: React.FC<RunOutputDialogPropsI> = memo(
  function RunOutputDialog({ runId, command, onClose }) {
    const { text, status, exitCode, truncated, error } = useTaskRun(runId);
    const outputRef = useRef<HTMLPreElement>(null);

    // Follow the tail, exactly like LogViewer.
    useEffect(() => {
      if (outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    }, [text]);

    return (
      <Modal open={!!runId} onClose={onClose} title="Command output">
        <div className="space-y-3">
          {command && (
            <p className="font-mono text-xs text-text-secondary break-all">
              {command}
            </p>
          )}

          <div className="flex items-center gap-3 text-xs">
            <span className={cn(STATUS_STYLES[status ?? ""] ?? "text-text-secondary")}>
              {status ?? "…"}
            </span>
            {exitCode !== null && (
              <span className="text-text-muted">exit {exitCode}</span>
            )}
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
            >
              {error}
            </div>
          ) : (
            <>
              <pre
                ref={outputRef}
                className="bg-surface-0 border border-border rounded-lg p-3 font-mono text-xs whitespace-pre-wrap break-all max-h-96 overflow-y-auto text-text-secondary"
              >
                {text || "No output yet."}
              </pre>
              {truncated && (
                <p className="text-xs text-text-muted">
                  Output truncated — showing the last 64 KB.
                </p>
              )}
            </>
          )}
        </div>
      </Modal>
    );
  },
);
