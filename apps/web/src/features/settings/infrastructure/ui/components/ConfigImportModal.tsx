import { memo, useRef } from "react";
import { AlertTriangle, FileUp, KeyRound, Upload } from "lucide-react";

import { Button } from "@shared/components/button";
import { Modal } from "@shared/components/modal";

import { useConfigImport } from "@settings/infrastructure/ui/hooks/useConfigImport";

import type { ImportPlanI, PlanActionT } from "@deploykit/shared";

interface ConfigImportModalPropsI {
  open: boolean;
  onClose: () => void;
}

const ACTION_LABELS: Record<PlanActionT, string> = {
  create: "Will be created",
  "skip-exists": "Already there",
  skip: "Skipped",
  error: "Cannot be imported",
};

const ACTION_TONE: Record<PlanActionT, string> = {
  create: "text-success",
  "skip-exists": "text-text-muted",
  skip: "text-warning",
  error: "text-danger",
};

const PlanGroup: React.FC<{ plan: ImportPlanI; action: PlanActionT }> = ({
  plan,
  action,
}) => {
  const items = plan.items.filter((item) => item.action === action);
  if (items.length === 0) return null;

  return (
    <details open={action === "error" || action === "create"}>
      <summary className="text-xs cursor-pointer text-text-secondary">
        <span className={ACTION_TONE[action]}>{ACTION_LABELS[action]}</span> ·{" "}
        {items.length}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {items.map((item, index) => (
          <li key={index} className="text-xs flex flex-wrap gap-x-2">
            <span className="text-text-muted font-mono">{item.kind}</span>
            <span className="text-text-primary">{item.path}</span>
            {item.reason && (
              <span className="text-text-secondary">— {item.reason}</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
};

export const ConfigImportModal: React.FC<ConfigImportModalPropsI> = memo(
  function ConfigImportModal({ open, onClose }) {
    const {
      manifest,
      secrets,
      allowLocalFallback,
      setAllowLocalFallback,
      plan,
      pickFile,
      preview,
      apply,
      reset,
      running,
      error,
      blocked,
    } = useConfigImport();

    const manifestInput = useRef<HTMLInputElement>(null);
    const secretsInput = useRef<HTMLInputElement>(null);

    const close = () => {
      reset();
      onClose();
    };

    return (
      <Modal open={open} onClose={close} title="Import configuration">
        <div className="space-y-4">
          <p className="text-xs text-text-secondary">
            Nothing is written until you confirm the plan. An import creates
            what is missing and never changes what is already here, and it
            deploys nothing — imported applications and stacks wait for a
            deploy, imported databases for their first Start.
          </p>

          {/* File pickers */}
          <div className="space-y-2">
            <input
              ref={manifestInput}
              type="file"
              accept=".yaml,.yml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                void pickFile(file, "manifest");
              }}
            />
            <input
              ref={secretsInput}
              type="file"
              accept=".yaml,.yml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                void pickFile(file, "secrets");
              }}
            />

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => manifestInput.current?.click()}
              >
                <FileUp className="w-3.5 h-3.5" />
                Choose manifest
              </Button>
              <span className="text-xs font-mono text-text-muted">
                {manifest?.name ?? "no file chosen"}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => secretsInput.current?.click()}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Choose secrets file
              </Button>
              <span className="text-xs font-mono text-text-muted">
                {secrets?.name ?? "optional"}
              </span>
            </div>
          </div>

          <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allowLocalFallback}
              onChange={(e) => setAllowLocalFallback(e.target.checked)}
              className="rounded mt-0.5"
            />
            <span>
              Run on the local host when a server named in the file does not
              exist here. Without this, a missing server stops the import.
            </span>
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger"
            >
              {error}
            </div>
          )}

          {/* Plan */}
          {plan && (
            <div className="space-y-3 pt-3 border-t border-border">
              {plan.applied ? (
                <p className="text-sm text-success">
                  Imported. {plan.counts.create} resource
                  {plan.counts.create === 1 ? "" : "s"} created.
                </p>
              ) : (
                <p className="text-sm">
                  <span className="text-success font-medium">
                    {plan.counts.create} to create
                  </span>
                  <span className="text-text-muted">
                    {" "}
                    · {plan.counts["skip-exists"]} already there ·{" "}
                    {plan.counts.skip} skipped
                  </span>
                  {plan.counts.error > 0 && (
                    <span className="text-danger">
                      {" "}
                      · {plan.counts.error} blocking
                    </span>
                  )}
                </p>
              )}

              <div className="space-y-1.5">
                <PlanGroup plan={plan} action="error" />
                <PlanGroup plan={plan} action="create" />
                <PlanGroup plan={plan} action="skip" />
                <PlanGroup plan={plan} action="skip-exists" />
              </div>

              {plan.containerNameConflicts.length > 0 && (
                <details open>
                  <summary className="text-xs cursor-pointer text-warning flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Container names already in use ·{" "}
                    {plan.containerNameConflicts.length}
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-text-secondary">
                    {plan.containerNameConflicts.map((conflict, index) => (
                      <li key={index}>
                        <span className="font-mono text-text-primary">
                          {conflict.containerName}
                        </span>{" "}
                        is used by {conflict.alreadyUsedBy}. Deploying the
                        imported {conflict.kind} would replace that container.
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {plan.missingSecrets.length > 0 && (
                <details>
                  <summary className="text-xs cursor-pointer text-warning">
                    Withheld values with nothing to restore ·{" "}
                    {plan.missingSecrets.length}
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-text-secondary font-mono">
                    {plan.missingSecrets.map((entry, index) => (
                      <li key={index}>{entry}</li>
                    ))}
                  </ul>
                </details>
              )}

              {plan.warnings.length > 0 && (
                <details>
                  <summary className="text-xs cursor-pointer text-text-muted">
                    Warnings · {plan.warnings.length}
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-warning">
                    {plan.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={close}>
              {plan?.applied ? "Close" : "Cancel"}
            </Button>
            {!plan?.applied && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={preview}
                  disabled={!manifest || running}
                >
                  {running && !plan ? "Checking…" : "Preview"}
                </Button>
                <Button
                  size="sm"
                  onClick={apply}
                  disabled={!plan || blocked || running}
                >
                  <Upload className="w-3.5 h-3.5" />
                  {running && plan ? "Importing…" : "Import"}
                </Button>
              </>
            )}
          </div>
        </div>
      </Modal>
    );
  },
);
