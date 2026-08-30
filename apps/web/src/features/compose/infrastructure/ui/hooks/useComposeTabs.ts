import { useEffect, useState } from "react";

import { trpc } from "@lib/trpc";
import { useContainerLogs } from "@lib/socket";

import {
  SAVED_FEEDBACK_MS,
  LOGS_TAIL,
} from "@compose/infrastructure/ui/constants/compose.constants";

/**
 * Hooks de las pestañas del stack.
 *
 * Viven juntos porque comparten el mismo patrón — cargar del `stack` ya
 * cargado, mutar, invalidar `compose.byId` — y separarlos en seis ficheros de
 * treinta líneas solo añadiría ruido.
 */

/** Editor del docker-compose.yml. */
export const useComposeFileTab = (stack: any, composeId: string) => {
  const utils = trpc.useUtils();
  const [text, setText] = useState<string>("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof stack?.composeFile === "string") setText(stack.composeFile);
  }, [stack?.composeFile]);

  const mutation = trpc.compose.updateComposeFile.useMutation({
    onSuccess: () => {
      utils.compose.byId.invalidate({ id: composeId });
      setSaved(true);
      setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
    },
  });

  return {
    text,
    setText,
    saved,
    saving: mutation.isPending,
    error: mutation.error?.message ?? null,
    dirty: text !== (stack?.composeFile ?? ""),
    handleSave: () => mutation.mutate({ id: composeId, composeFile: text }),
  };
};

/** Editor KEY=VALUE del .env del stack. */
export const useComposeEnvTab = (stack: any, composeId: string) => {
  const utils = trpc.useUtils();
  const [envText, setEnvText] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const [showValues, setShowValues] = useState(false);

  useEffect(() => {
    if (stack?.envVars && typeof stack.envVars === "object") {
      setEnvText(
        Object.entries(stack.envVars as Record<string, string>)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n"),
      );
    }
  }, [stack?.envVars]);

  const mutation = trpc.compose.updateEnvVars.useMutation({
    onSuccess: () => {
      utils.compose.byId.invalidate({ id: composeId });
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
      if (key) vars[key] = trimmed.slice(eqIdx + 1).trim();
    }
    mutation.mutate({ id: composeId, envVars: vars });
  };

  return {
    envText,
    setEnvText,
    saved,
    showValues,
    setShowValues,
    saving: mutation.isPending,
    error: mutation.error?.message ?? null,
    handleSave,
  };
};

/** Alta y baja de dominios, cada uno apuntando a un servicio del stack. */
export const useComposeDomainsTab = (stack: any, composeId: string) => {
  const utils = trpc.useUtils();
  const services: string[] = stack?.services ?? [];

  const [serviceName, setServiceName] = useState<string>("");
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("80");
  const [https, setHttps] = useState(true);

  useEffect(() => {
    if (!serviceName && services.length > 0) setServiceName(services[0]!);
  }, [services, serviceName]);

  const invalidate = () => utils.compose.byId.invalidate({ id: composeId });

  const addMutation = trpc.compose.addDomain.useMutation({
    onSuccess: () => {
      invalidate();
      setDomain("");
    },
  });
  const removeMutation = trpc.compose.removeDomain.useMutation({
    onSuccess: invalidate,
  });

  return {
    services,
    serviceName,
    setServiceName,
    domain,
    setDomain,
    port,
    setPort,
    https,
    setHttps,
    adding: addMutation.isPending,
    error: addMutation.error?.message ?? null,
    handleAdd: () =>
      addMutation.mutate({
        id: composeId,
        serviceName,
        domain: domain.trim(),
        port: Number(port),
        https,
      }),
    handleRemove: (domainId: string) => removeMutation.mutate({ domainId }),
  };
};

/**
 * Logs de un contenedor concreto del stack.
 *
 * En vivo se sigue un contenedor (un stream por contenedor); el histórico es
 * del stack entero, porque todos sus contenedores persisten bajo el mismo
 * serviceId.
 */
export const useComposeLogs = (
  composeId: string,
  containerId: string | null,
) => {
  const [mode, setMode] = useState<"live" | "history">("live");

  const { data: logsData } = trpc.compose.containerLogs.useQuery(
    { id: composeId, containerId: containerId ?? "", tail: LOGS_TAIL },
    { enabled: mode === "live" && !!containerId },
  );

  const { logs: liveLogs } = useContainerLogs(
    mode === "live" ? containerId : null,
  );

  const allLogs = [
    ...(logsData?.logs ? logsData.logs.split("\n") : []),
    ...liveLogs,
  ];

  return { mode, setMode, allLogs };
};
