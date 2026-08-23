import { useEffect, useRef, useState, useCallback, memo } from "react";
import { TerminalSquare, Power, Maximize2, Minimize2 } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { useAuthStore } from "@lib/auth";
import { useTerminal } from "@lib/socket";

import "@xterm/xterm/css/xterm.css";

interface TerminalTabPropsI {
  app: any;
}

export const TerminalTab: React.FC<TerminalTabPropsI> = memo(
  function TerminalTab({ app }) {
    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);

    const canOperate = useAuthStore((s) => {
      const role = s.user?.role;
      return role === "admin" || role === "operator";
    });

    const { session, start, write, resize, stop } = useTerminal(
      app.containerId,
    );

    // Refs to always access latest write/resize inside closures
    const writeRef = useRef(write);
    const resizeRef = useRef(resize);
    writeRef.current = write;
    resizeRef.current = resize;

    // Initialize xterm
    useEffect(() => {
      if (!termRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        theme: {
          background: "#0d1117",
          foreground: "#c9d1d9",
          cursor: "#58a6ff",
          selectionBackground: "#264f78",
          black: "#0d1117",
          red: "#ff7b72",
          green: "#7ee787",
          yellow: "#d29922",
          blue: "#58a6ff",
          magenta: "#bc8cff",
          cyan: "#76e3ea",
          white: "#c9d1d9",
          brightBlack: "#6e7681",
          brightRed: "#ffa198",
          brightGreen: "#aff5b4",
          brightYellow: "#e3b341",
          brightBlue: "#79c0ff",
          brightMagenta: "#d2a8ff",
          brightCyan: "#a5d6ff",
          brightWhite: "#f0f6fc",
        },
        scrollback: 5000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(termRef.current);

      // Small delay to ensure container is rendered
      requestAnimationFrame(() => {
        fitAddon.fit();
      });

      // Forward keystrokes to the server
      term.onData((data) => {
        writeRef.current(data);
      });

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Resize observer
      const observer = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (fitAddonRef.current && xtermRef.current) {
            fitAddonRef.current.fit();
            const { cols, rows } = xtermRef.current;
            resizeRef.current(cols, rows);
          }
        });
      });

      observer.observe(termRef.current);

      return () => {
        observer.disconnect();
        term.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Handle resize on expand/collapse
    useEffect(() => {
      requestAnimationFrame(() => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit();
          const { cols, rows } = xtermRef.current;
          resizeRef.current(cols, rows);
        }
      });
    }, [isExpanded]);

    const handleConnect = useCallback(() => {
      if (!xtermRef.current || !fitAddonRef.current) return;

      fitAddonRef.current.fit();
      const { cols, rows } = xtermRef.current;

      xtermRef.current.clear();
      xtermRef.current.writeln("\x1b[90mConnecting to container...\x1b[0m");

      const onData = (data: string) => {
        xtermRef.current?.write(data);
      };

      // Clean up any previous listener
      cleanupRef.current?.();
      cleanupRef.current = start(onData, cols, rows) || null;
    }, [start]);

    const handleDisconnect = useCallback(() => {
      stop();
      cleanupRef.current?.();
      cleanupRef.current = null;
      xtermRef.current?.writeln("\r\n\x1b[90mSession disconnected.\x1b[0m");
    }, [stop]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (session.isConnected) {
          stop();
        }
        cleanupRef.current?.();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Write status messages to terminal
    useEffect(() => {
      if (!xtermRef.current) return;

      if (session.isConnected && session.shell) {
        xtermRef.current.writeln(
          `\x1b[32m✓ Connected\x1b[0m \x1b[90m(${session.shell})\x1b[0m\r`,
        );
      }

      if (session.error) {
        xtermRef.current.writeln(`\r\n\x1b[31m✗ ${session.error}\x1b[0m`);
      }
    }, [session.isConnected, session.shell, session.error]);

    // No container state
    if (!app.containerId || app.status !== "running") {
      return (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <TerminalSquare className="w-10 h-10 text-text-muted mb-3" />
            <h3 className="text-sm font-medium mb-1">Terminal unavailable</h3>
            <p className="text-xs text-text-muted">
              Deploy and start your application to use the web terminal.
            </p>
          </div>
        </Card>
      );
    }

    // Not authorized
    if (!canOperate) {
      return (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <TerminalSquare className="w-10 h-10 text-text-muted mb-3" />
            <h3 className="text-sm font-medium mb-1">Access restricted</h3>
            <p className="text-xs text-text-muted">
              Operator or admin role required to access the terminal.
            </p>
          </div>
        </Card>
      );
    }

    return (
      <div
        className={
          isExpanded ? "fixed inset-0 z-50 bg-[#0d1117] p-4 flex flex-col" : ""
        }
      >
        {/* Toolbar */}
        <div
          className={`flex items-center justify-between mb-2 ${
            isExpanded ? "" : ""
          }`}
        >
          <div className="flex items-center gap-2">
            <TerminalSquare className="w-4 h-4 text-text-secondary" />
            <span className="text-sm font-medium">Terminal</span>
            {session.isConnected && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                Connected
              </span>
            )}
            {session.isConnecting && (
              <span className="text-xs text-text-muted">Connecting…</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Exit fullscreen" : "Fullscreen"}
            >
              {isExpanded ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </Button>

            {!session.isConnected && !session.isConnecting ? (
              <Button size="sm" onClick={handleConnect}>
                <TerminalSquare className="w-3.5 h-3.5" />
                Connect
              </Button>
            ) : (
              <Button
                variant="danger"
                size="sm"
                onClick={handleDisconnect}
                disabled={session.isConnecting}
              >
                <Power className="w-3.5 h-3.5" />
                Disconnect
              </Button>
            )}
          </div>
        </div>

        {/* Terminal */}
        <div
          className={`rounded-lg overflow-hidden border border-border ${
            isExpanded ? "flex-1" : ""
          }`}
          style={isExpanded ? {} : { height: "420px" }}
        >
          <div
            ref={termRef}
            className="w-full h-full"
            style={{ backgroundColor: "#0d1117", padding: "8px" }}
          />
        </div>

        {/* Helper text */}
        {!isExpanded && (
          <p className="text-[11px] text-text-muted mt-1.5">
            Click Connect to open an interactive shell in the container. Session
            auto-closes after 15 min of inactivity.
          </p>
        )}
      </div>
    );
  },
);
