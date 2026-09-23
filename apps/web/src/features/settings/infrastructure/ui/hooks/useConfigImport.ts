import { useState } from "react";

import { trpc } from "@lib/trpc";

import { MANIFEST_SIZE_LIMIT } from "@settings/infrastructure/ui/constants/settings.constants";

import type { ImportPlanI } from "@deploykit/shared";

interface PickedFileI {
  name: string;
  text: string;
}

/**
 * Applying a configuration manifest.
 *
 * Preview and apply are the same procedure with `dryRun` flipped, so what the
 * operator confirms is exactly what runs — the server re-plans on apply rather
 * than trusting a plan sent back to it.
 */
export const useConfigImport = () => {
  const utils = trpc.useUtils();
  const [manifest, setManifest] = useState<PickedFileI | null>(null);
  const [secrets, setSecrets] = useState<PickedFileI | null>(null);
  const [allowLocalFallback, setAllowLocalFallback] = useState<boolean>(false);
  const [plan, setPlan] = useState<ImportPlanI | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const importMutation = trpc.config.import.useMutation({
    onSuccess: (result) => {
      setPlan(result);
      if (result.applied) {
        utils.project.list.invalidate();
        utils.dashboard.invalidate();
      }
    },
  });

  const pickFile = async (file: File | undefined, kind: "manifest" | "secrets") => {
    if (!file) return;
    setReadError(null);
    setPlan(null);
    if (file.size > MANIFEST_SIZE_LIMIT) {
      setReadError(
        `${file.name} is larger than ${Math.round(MANIFEST_SIZE_LIMIT / 1_000_000)} MB, which is the most an import accepts.`,
      );
      return;
    }
    const text = await file.text();
    const picked = { name: file.name, text };
    if (kind === "manifest") setManifest(picked);
    else setSecrets(picked);
  };

  const run = (dryRun: boolean) => {
    if (!manifest) return;
    importMutation.mutate({
      manifest: manifest.text,
      secrets: secrets?.text,
      dryRun,
      onMissingServer: allowLocalFallback ? "local" : "fail",
    });
  };

  const reset = () => {
    setManifest(null);
    setSecrets(null);
    setPlan(null);
    setReadError(null);
    importMutation.reset();
  };

  return {
    manifest,
    secrets,
    allowLocalFallback,
    setAllowLocalFallback,
    plan,
    pickFile,
    preview: () => run(true),
    apply: () => run(false),
    reset,
    running: importMutation.isPending,
    error: readError ?? importMutation.error?.message ?? null,
    /** A plan with an error cannot be applied: the import is one transaction. */
    blocked: (plan?.counts.error ?? 0) > 0,
  };
};
