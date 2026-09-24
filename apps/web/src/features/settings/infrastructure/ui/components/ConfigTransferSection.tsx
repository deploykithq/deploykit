import { useState } from "react";
import { FileDown, KeyRound, Upload } from "lucide-react";

import { Button } from "@shared/components/button";
import { FormStatus } from "@shared/components/form-status";

import { SectionCard } from "@settings/infrastructure/ui/components";
import { ConfigImportModal } from "@settings/infrastructure/ui/components/ConfigImportModal";

import { useConfigTransfer } from "@settings/infrastructure/ui/hooks/useConfigTransfer";

export const ConfigTransferSection: React.FC = () => {
  const { exportConfiguration, exportSecrets, exporting, error, warnings, done } =
    useConfigTransfer();
  const [showImport, setShowImport] = useState<boolean>(false);

  return (
    <SectionCard icon={FileDown} title="Configuration export and import">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          A YAML snapshot of every project, application, database, Compose
          stack, domain, scheduled task and env var. Keep it in git to review
          infrastructure changes, or apply it on a new host to rebuild this
          instance.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={exportConfiguration}
            disabled={exporting}
          >
            <FileDown className="w-3.5 h-3.5" />
            Export configuration
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={exportSecrets}
            disabled={exporting}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Export secrets
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowImport(true)}>
            <Upload className="w-3.5 h-3.5" />
            Import
          </Button>
          <FormStatus success={done !== null} successMessage={done ?? ""} error={error} />
        </div>

        <div className="p-3 rounded-lg bg-surface-2 border border-border space-y-1.5">
          <p className="text-xs text-text-muted">
            Passwords, tokens and anything else that looks like a credential are
            withheld from the configuration file — it lists their names only.
            The secrets file carries their values in plain text, so download it
            only for a restore and never commit it.
          </p>
          <p className="text-xs text-text-muted">
            The configuration file does contain each stack&rsquo;s Compose file
            and the names of every env var, so review it before pushing it to a
            public repository.
          </p>
        </div>

        {warnings.length > 0 && (
          <details>
            <summary className="text-xs text-text-muted cursor-pointer">
              Warnings from the last export · {warnings.length}
            </summary>
            <ul className="mt-1 space-y-0.5 text-xs text-warning">
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <ConfigImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
      />
    </SectionCard>
  );
};
