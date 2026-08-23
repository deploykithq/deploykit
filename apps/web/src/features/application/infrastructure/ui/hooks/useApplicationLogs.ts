import { useState } from "react";

import { useContainerLogs } from "@lib/socket";
import { trpc } from "@lib/trpc";

import { LOGS_TAIL } from "@application/infrastructure/ui/constants/application.constants";

import type { LogModeT } from "@application/infrastructure/ui/interfaces/application.interfaces";

export const useApplicationLogs = (app: any) => {
  const [mode, setMode] = useState<LogModeT>("live");

  const { data: logsData } = trpc.application.logs.useQuery(
    { id: app.id, tail: LOGS_TAIL },
    { enabled: mode === "live" && !!app.containerId },
  );

  const { logs: liveLogs } = useContainerLogs(
    mode === "live" ? app.containerId : null,
  );

  const allLogs = [
    ...(logsData?.logs ? logsData.logs.split("\n") : []),
    ...liveLogs,
  ];

  return { mode, setMode, allLogs };
};
