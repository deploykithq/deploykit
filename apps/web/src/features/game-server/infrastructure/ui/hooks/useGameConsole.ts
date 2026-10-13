import { useCallback, useEffect, useRef, useState } from "react";

import { getSocket } from "@lib/socket";
import { trpc } from "@lib/trpc";

import { CONSOLE_HISTORY_MAX } from "@game-server/infrastructure/ui/constants/game-server.constants";

/**
 * Follow a container's log stream line by line.
 *
 * Same room and events as `useContainerLogs`, but delivered through a
 * callback: the console writes each line into xterm as it arrives instead of
 * re-rendering a growing array.
 */
const useContainerLogLines = (
  containerId: string | null,
  onLine: (line: string) => void,
) => {
  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;

  useEffect(() => {
    if (!containerId) return;
    const s = getSocket();
    s.emit("subscribe:logs", containerId);

    const handleLog = (data: { containerId: string; log: string }) => {
      if (data.containerId === containerId) onLineRef.current(data.log);
    };
    s.on("container:log", handleLog);

    return () => {
      s.emit("unsubscribe:logs", containerId);
      s.off("container:log", handleLog);
    };
  }, [containerId]);
};

/**
 * The console tab: send a command, keep a ↑/↓ history.
 *
 * Replies are not printed from the mutation's result: RCON output is also
 * written to the server log, which the terminal already follows, so printing
 * it here would show every answer twice.
 */
export const useGameConsole = (
  gameServerId: string,
  containerId: string | null,
  onLine: (line: string) => void,
  onEcho: (command: string) => void,
) => {
  useContainerLogLines(containerId, onLine);

  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  // -1 = editing a new command; otherwise an index into `history` (newest last).
  const [cursor, setCursor] = useState(-1);
  const draftRef = useRef("");

  const sendMutation = trpc.gameServer.consoleSend.useMutation();

  const submit = useCallback(() => {
    const cmd = command.trim();
    if (!cmd || sendMutation.isPending) return;
    onEcho(cmd);
    sendMutation.mutate({ id: gameServerId, command: cmd });
    setHistory((prev) => {
      const next = prev[prev.length - 1] === cmd ? prev : [...prev, cmd];
      return next.slice(-CONSOLE_HISTORY_MAX);
    });
    setCursor(-1);
    draftRef.current = "";
    setCommand("");
  }, [command, gameServerId, onEcho, sendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      const next = cursor === -1 ? history.length - 1 : Math.max(0, cursor - 1);
      if (cursor === -1) draftRef.current = command;
      setCursor(next);
      setCommand(history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      if (cursor === -1) return;
      e.preventDefault();
      const next = cursor + 1;
      if (next >= history.length) {
        setCursor(-1);
        setCommand(draftRef.current);
      } else {
        setCursor(next);
        setCommand(history[next] ?? "");
      }
    }
  };

  return {
    command,
    setCommand: (value: string) => {
      setCommand(value);
      setCursor(-1);
    },
    handleKeyDown,
    submit,
    sending: sendMutation.isPending,
    error: sendMutation.error?.message ?? null,
  };
};
