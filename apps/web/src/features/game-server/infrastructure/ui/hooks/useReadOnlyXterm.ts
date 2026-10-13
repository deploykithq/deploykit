import { useCallback, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

import { XTERM_THEME } from "@game-server/infrastructure/ui/constants/game-server.constants";

import "@xterm/xterm/css/xterm.css";

/**
 * A read-only xterm (no stdin): the game console renders the server log with
 * its ANSI colours, and commands go through a separate input.
 */
export const useReadOnlyXterm = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // Lines that arrive before xterm is mounted (the socket can be faster).
  const pendingRef = useRef<string[]>([]);

  useEffect(() => {
    if (!mountRef.current) return;

    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: XTERM_THEME,
      scrollback: 5000,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(mountRef.current);
    requestAnimationFrame(() => fit.fit());

    termRef.current = term;
    for (const chunk of pendingRef.current) term.write(chunk);
    pendingRef.current = [];

    const observer = new ResizeObserver(() =>
      requestAnimationFrame(() => {
        if (termRef.current) fit.fit();
      }),
    );
    observer.observe(mountRef.current);

    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  const write = useCallback((chunk: string) => {
    if (termRef.current) termRef.current.write(chunk);
    else pendingRef.current.push(chunk);
  }, []);

  /** One log line; the stream delivers lines without their newline. */
  const writeLine = useCallback(
    (line: string) => write(`${line.replace(/\r?\n$/, "")}\n`),
    [write],
  );

  /** Echo a command the user sent, dimmed, so the log reads as a session. */
  const writeEcho = useCallback(
    (command: string) => write(`\x1b[36m> ${command}\x1b[0m\n`),
    [write],
  );

  const clear = useCallback(() => termRef.current?.clear(), []);

  return { mountRef, writeLine, writeEcho, clear };
};
