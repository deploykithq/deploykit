import { useState } from "react";

import { trpc } from "@lib/trpc";
import { downloadTextFile } from "@lib/utils";

/**
 * Downloading the instance's configuration.
 *
 * The manifest and the secrets file are two separate buttons on purpose: each
 * download then happens inside its own click, which is what keeps browsers
 * from prompting about multiple downloads, and it makes asking for the secrets
 * a deliberate act rather than a side effect of exporting.
 */
export const useConfigTransfer = () => {
  const [warnings, setWarnings] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const exportMutation = trpc.config.exportInstance.useMutation();

  const flash = (message: string) => {
    setDone(message);
    setTimeout(() => setDone(null), 4000);
  };

  const stamp = (): string => new Date().toISOString().slice(0, 10);

  const exportConfiguration = async () => {
    try {
      const result = await exportMutation.mutateAsync({ includeSecrets: false });
      downloadTextFile(
        `deploykit-config-${stamp()}.yaml`,
        result.manifest,
        "text/yaml",
      );
      setWarnings(result.warnings);
      flash(
        `Exported ${result.counts.projects} project${result.counts.projects === 1 ? "" : "s"}`,
      );
    } catch {
      // Rendered from exportMutation.error.
    }
  };

  const exportSecrets = async () => {
    try {
      const result = await exportMutation.mutateAsync({ includeSecrets: true });
      if (!result.secrets) {
        setWarnings([]);
        flash("Nothing was withheld, so there is no secrets file");
        return;
      }
      downloadTextFile(
        `deploykit-secrets-${stamp()}.yaml`,
        result.secrets,
        "text/yaml",
      );
      setWarnings(result.warnings);
      flash("Secrets file downloaded");
    } catch {
      // Rendered from exportMutation.error.
    }
  };

  return {
    exportConfiguration,
    exportSecrets,
    exporting: exportMutation.isPending,
    error: exportMutation.error?.message ?? null,
    warnings,
    done,
  };
};
