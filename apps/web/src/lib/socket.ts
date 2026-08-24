import { useEffect, useState, useCallback, useRef } from "react";
import { io, type Socket } from "socket.io-client";

import { trpc } from "./trpc";

let socket: Socket | null = null;

const getSocket = (): Socket => {
  if (!socket) {
    socket = io(window.location.origin, {
      path: "/ws",
      transports: ["websocket"],
      // Callback form so reconnects always pick up the current token
      auth: (cb) => cb({ token: localStorage.getItem("accessToken") }),
    });
  }
  return socket;
};

/**
 * Force a fresh handshake (e.g. right after login) so the server
 * authenticates the socket with the new access token.
 */
const reconnectSocket = (): void => {
  if (socket) {
    socket.disconnect();
    socket.connect();
  }
};

/**
 * Subscribe to deployment logs in real-time.
 */
const useDeployLogs = (deploymentId: string | null) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!deploymentId) return;

    const s = getSocket();
    s.emit("subscribe:deployment", deploymentId);

    const handleLog = (data: { deploymentId: string; log: string }) => {
      if (data.deploymentId === deploymentId) {
        setLogs((prev) => [...prev, data.log]);
      }
    };

    const handleStatus = (data: { deploymentId: string; status: string }) => {
      if (data.deploymentId === deploymentId) {
        setStatus(data.status);
      }
    };

    s.on("deploy:log", handleLog);
    s.on("deploy:status", handleStatus);

    return () => {
      s.emit("unsubscribe:deployment", deploymentId);
      s.off("deploy:log", handleLog);
      s.off("deploy:status", handleStatus);
    };
  }, [deploymentId]);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, status, clearLogs };
};

/**
 * Subscribe to live container logs.
 */
const useContainerLogs = (containerId: string | null) => {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    if (!containerId) return;

    const s = getSocket();
    s.emit("subscribe:logs", containerId);

    const handleLog = (data: { containerId: string; log: string }) => {
      if (data.containerId === containerId) {
        setLogs((prev) => {
          const next = [...prev, data.log];
          // Keep last 500 lines
          return next.length > 500 ? next.slice(-500) : next;
        });
      }
    };

    s.on("container:log", handleLog);

    return () => {
      s.emit("unsubscribe:logs", containerId);
      s.off("container:log", handleLog);
    };
  }, [containerId]);

  return { logs };
};

/**
 * Listen for service status updates to invalidate queries.
 */
const useServiceUpdates = () => {
  const utils = trpc.useUtils();

  useEffect(() => {
    const s = getSocket();

    const handleUpdate = () => {
      // Invalidate relevant queries so the UI refreshes
      utils.project.list.invalidate();
      utils.project.byId.invalidate();
    };

    s.on("service:updated", handleUpdate);
    return () => {
      s.off("service:updated", handleUpdate);
    };
  }, [utils]);
};

export {
  getSocket,
  reconnectSocket,
  useDeployLogs,
  useContainerLogs,
  useServiceUpdates,
};

export interface MetricsUpdate {
  serviceId: string;
  serviceType: string;
  serviceName: string;
  ts: number;
  cpu: number;
  memPercent: number;
  memUsed: number;
  memTotal: number;
  netRx: number;
  netTx: number;
  diskUsed: number;
}

/**
 * Subscribe to live metrics for a single service.
 * Returns the latest sample; updates every 30s.
 */
export const useServiceMetrics = (serviceId: string | null) => {
  const [latest, setLatest] = useState<MetricsUpdate | null>(null);

  useEffect(() => {
    if (!serviceId) return;
    const s = getSocket();
    s.emit("subscribe:metrics", serviceId);

    const handler = (data: MetricsUpdate) => {
      if (data.serviceId === serviceId) setLatest(data);
    };

    s.on("metrics:update", handler);
    return () => {
      s.emit("unsubscribe:metrics", serviceId);
      s.off("metrics:update", handler);
    };
  }, [serviceId]);

  return latest;
};

export interface TerminalSession {
  sessionId: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  shell: string | null;
}

/**
 * Manages a web terminal session over Socket.IO.
 * Returns methods to start, write, resize, and stop the session.
 */
export const useTerminal = (containerId: string | null) => {
  const [session, setSession] = useState<TerminalSession>({
    sessionId: null,
    isConnected: false,
    isConnecting: false,
    error: null,
    shell: null,
  });

  // Store the output callback ref so we can register/unregister it
  const onDataRef = useRef<((data: string) => void) | null>(null);

  const start = useCallback(
    (onData: (data: string) => void, cols = 80, rows = 24) => {
      if (!containerId) return;

      const token = localStorage.getItem("accessToken");
      if (!token) {
        setSession((s) => ({ ...s, error: "Not authenticated" }));
        return;
      }

      const s = getSocket();
      onDataRef.current = onData;

      setSession((prev) => ({ ...prev, isConnecting: true, error: null }));

      // Register listeners
      const handleReady = (data: { sessionId: string; shell: string }) => {
        setSession({
          sessionId: data.sessionId,
          isConnected: true,
          isConnecting: false,
          error: null,
          shell: data.shell,
        });
      };

      const handleOutput = (data: { sessionId: string; data: string }) => {
        onDataRef.current?.(data.data);
      };

      const handleError = (data: { sessionId: string; error: string }) => {
        setSession((prev) => ({
          ...prev,
          isConnecting: false,
          isConnected: false,
          error: data.error,
        }));
      };

      const handleEnded = (data: { sessionId: string; reason: string }) => {
        setSession({
          sessionId: null,
          isConnected: false,
          isConnecting: false,
          error:
            data.reason === "inactivity"
              ? "Session closed due to inactivity"
              : data.reason === "user"
                ? null
                : `Session ended: ${data.reason}`,
          shell: null,
        });
      };

      s.on("terminal:ready", handleReady);
      s.on("terminal:output", handleOutput);
      s.on("terminal:error", handleError);
      s.on("terminal:ended", handleEnded);

      // Start session
      s.emit("terminal:start", { containerId, token, cols, rows });

      // Return cleanup
      return () => {
        s.off("terminal:ready", handleReady);
        s.off("terminal:output", handleOutput);
        s.off("terminal:error", handleError);
        s.off("terminal:ended", handleEnded);
      };
    },
    [containerId],
  );

  const write = useCallback(
    (data: string) => {
      if (!session.sessionId) return;
      getSocket().emit("terminal:input", {
        sessionId: session.sessionId,
        data,
      });
    },
    [session.sessionId],
  );

  const resize = useCallback(
    (cols: number, rows: number) => {
      if (!session.sessionId) return;
      getSocket().emit("terminal:resize", {
        sessionId: session.sessionId,
        cols,
        rows,
      });
    },
    [session.sessionId],
  );

  const stop = useCallback(() => {
    if (!session.sessionId) return;
    getSocket().emit("terminal:stop", { sessionId: session.sessionId });
    setSession({
      sessionId: null,
      isConnected: false,
      isConnecting: false,
      error: null,
      shell: null,
    });
  }, [session.sessionId]);

  return { session, start, write, resize, stop };
};

export interface AlertFired {
  eventId: string;
  ruleId: string;
  serviceName: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
}

/**
 * Listens for alert:fired events and returns the last N alerts as a
 * toast-friendly queue.
 */
export const useAlertNotifications = (maxQueue = 5) => {
  const [alerts, setAlerts] = useState<AlertFired[]>([]);
  const utils = trpc.useUtils();

  useEffect(() => {
    const s = getSocket();

    const onFired = (data: AlertFired) => {
      setAlerts((prev) => [data, ...prev].slice(0, maxQueue));
      // Refresh open-alert count in sidebar / stats
      utils.metrics.alertStats.invalidate();
      utils.metrics.recentEvents.invalidate();
    };

    const onResolved = () => {
      utils.metrics.alertStats.invalidate();
      utils.metrics.recentEvents.invalidate();
    };

    s.on("alert:fired", onFired);
    s.on("alert:resolved", onResolved);
    return () => {
      s.off("alert:fired", onFired);
      s.off("alert:resolved", onResolved);
    };
  }, [utils, maxQueue]);

  const dismiss = useCallback((eventId: string) => {
    setAlerts((prev) => prev.filter((a) => a.eventId !== eventId));
  }, []);

  return { alerts, dismiss };
};
