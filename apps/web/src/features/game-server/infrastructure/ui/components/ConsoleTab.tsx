import { memo } from "react";
import { Eraser, SendHorizontal, TerminalSquare } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { useGameConsole } from "@game-server/infrastructure/ui/hooks/useGameConsole";
import { useReadOnlyXterm } from "@game-server/infrastructure/ui/hooks/useReadOnlyXterm";

import type { GameServerTabPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * Live server console: the container log in a read-only terminal, and a
 * command line underneath (RCON or stdin, depending on the game).
 */
export const ConsoleTab: React.FC<GameServerTabPropsI> = memo(function ConsoleTab({
  server,
  permissions,
}) {
  const { mountRef, writeLine, writeEcho, clear } = useReadOnlyXterm();
  const { command, setCommand, handleKeyDown, submit, sending, error } =
    useGameConsole(server.id, server.containerId ?? null, writeLine, writeEcho);

  const running = server.status === "running";
  const canSend = permissions.canExecute && running;
  const method = server.spec.console.method;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <TerminalSquare className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium">Console</h3>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-mono">
            {method}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={clear} title="Clear the screen">
          <Eraser className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="rounded-lg overflow-hidden border border-border" style={{ height: "420px" }}>
        <div
          ref={mountRef}
          className="w-full h-full"
          style={{ backgroundColor: "#0d1117", padding: "8px" }}
        />
      </div>

      {!server.containerId && (
        <p className="text-xs text-text-muted mt-2">
          No container yet — the log appears once the server has been
          provisioned.
        </p>
      )}

      {permissions.canExecute ? (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border focus-within:border-accent transition-colors">
              <span className="text-accent font-mono text-sm">&gt;</span>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!canSend}
                maxLength={1000}
                placeholder={
                  running
                    ? "Type a command and press Enter (↑/↓ for history)"
                    : "Start the server to send commands"
                }
                spellCheck={false}
                autoComplete="off"
                className="flex-1 bg-transparent text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
              />
            </div>
            <Button
              size="sm"
              onClick={submit}
              disabled={!canSend || sending || !command.trim()}
            >
              <SendHorizontal className="w-3.5 h-3.5" />
              Send
            </Button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          {server.spec.contract && (
            <p className="text-xs text-text-muted">
              Besides the game's own commands:{" "}
              <code className="font-mono">/dk status</code> and{" "}
              <code className="font-mono">/dk save</code>.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-text-muted mt-3">
          Sending commands needs the global operator role and operator access
          to this project.
        </p>
      )}
    </Card>
  );
});
