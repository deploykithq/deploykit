import { useEffect, useState } from "react";

import { trpc } from "@lib/trpc";

import { SAVED_FEEDBACK_MS } from "@application/infrastructure/ui/constants/application.constants";

export const useEnvVarsTab = (app: any, applicationId: string) => {
  const utils = trpc.useUtils();

  const [envText, setEnvText] = useState<string>("");
  const [saved, setSaved] = useState<boolean>(false);
  const [showValues, setShowValues] = useState<boolean>(false);

  useEffect(() => {
    if (app.envVars && typeof app.envVars === "object") {
      const text = Object.entries(app.envVars as Record<string, string>)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      setEnvText(text);
    }
  }, [app.envVars]);

  const updateMutation = trpc.application.updateEnvVars.useMutation({
    onSuccess: () => {
      utils.application.byId.invalidate({ id: applicationId });
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
    },
  });

  const handleSave = () => {
    const vars: Record<string, string> = {};
    for (const line of envText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key) vars[key] = value;
    }
    updateMutation.mutate({ id: applicationId, envVars: vars });
  };

  return {
    envText,
    setEnvText,
    saved,
    showValues,
    setShowValues,
    saving: updateMutation.isPending,
    handleSave,
  };
};
