import type { Socket } from "socket.io";
import { docker } from "../lib/docker";
import { verifySocketAuth } from "../lib/socket-auth";
import type Dockerode from "dockerode";

interface TerminalSession {
  exec: Dockerode.Exec;
  stream: NodeJS.ReadWriteStream;
  containerId: string;
  socketId: string;
  inactivityTimer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, TerminalSession>();

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const ALLOWED_SHELLS = ["/bin/sh", "/bin/bash", "/bin/ash"];

async function detectShell(containerId: string): Promise<string> {
  for (const shell of ALLOWED_SHELLS) {
    try {
      const exec = await docker.getContainer(containerId).exec({
        Cmd: ["which", shell],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false, Tty: false });

      const result = await new Promise<string>((resolve) => {
        let output = "";
        stream.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        stream.on("end", () => resolve(output.trim()));
        setTimeout(() => resolve(""), 2000);
      });

      if (result.includes(shell)) return shell;
    } catch {
      // Shell not found, try next
    }
  }
  return "/bin/sh"; // Fallback
}

function resetInactivityTimer(sessionId: string, socket: Socket): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  clearTimeout(session.inactivityTimer);
  session.inactivityTimer = setTimeout(() => {
    socket.emit("terminal:output", {
      sessionId,
      data: "\r\n\x1b[33m⚠ Session closed due to inactivity (15 min)\x1b[0m\r\n",
    });
    destroySession(sessionId);
    socket.emit("terminal:ended", { sessionId, reason: "inactivity" });
  }, INACTIVITY_TIMEOUT_MS);
}

function destroySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  clearTimeout(session.inactivityTimer);

  try {
    session.stream.end();
  } catch {
    // Stream may already be closed
  }

  sessions.delete(sessionId);
  console.log(`[terminal] Session ${sessionId} destroyed`);
}


export function registerTerminalHandlers(socket: Socket): void {
  socket.on(
    "terminal:start",
    async (data: { containerId: string; token: string; cols?: number; rows?: number }) => {
      const { containerId, token, cols = 80, rows = 24 } = data;
      const sessionId = `term_${socket.id}_${Date.now()}`;

      // 1. Auth check — operator or admin only
      const auth = await verifySocketAuth(token);
      if (!auth || (auth.role !== "admin" && auth.role !== "operator")) {
        socket.emit("terminal:error", {
          sessionId,
          error: "Unauthorized — operator or admin role required",
        });
        return;
      }

      // 2. Verify container is managed by DeployKit
      try {
        const container = docker.getContainer(containerId);
        const info = await container.inspect();
        const labels = info.Config?.Labels || {};

        if (!labels["deploykit.managed"] && !labels["deploykit.service"]) {
          socket.emit("terminal:error", {
            sessionId,
            error: "Container is not managed by DeployKit",
          });
          return;
        }

        // Also verify container is running
        if (!info.State?.Running) {
          socket.emit("terminal:error", {
            sessionId,
            error: "Container is not running",
          });
          return;
        }
      } catch (err: any) {
        socket.emit("terminal:error", {
          sessionId,
          error: `Container not found: ${err.message}`,
        });
        return;
      }

      // 3. Detect shell
      const shell = await detectShell(containerId);
      console.log(
        `[terminal] Starting session ${sessionId} → container ${containerId.slice(0, 12)} (${shell})`,
      );

      // 4. Create exec
      try {
        const container = docker.getContainer(containerId);
        const exec = await container.exec({
          Cmd: [shell],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
          Env: ["TERM=xterm-256color"],
        });

        const stream = await exec.start({
          hijack: true,
          stdin: true,
          Tty: true,
        });

        // Resize immediately
        try {
          await exec.resize({ h: rows, w: cols });
        } catch {
          // Some containers don't support resize right away
        }

        // Store session
        const inactivityTimer = setTimeout(() => {}, 0);
        clearTimeout(inactivityTimer);

        sessions.set(sessionId, {
          exec,
          stream,
          containerId,
          socketId: socket.id,
          inactivityTimer,
        });

        resetInactivityTimer(sessionId, socket);

        // Pipe stdout → client
        stream.on("data", (chunk: Buffer) => {
          socket.emit("terminal:output", {
            sessionId,
            data: chunk.toString("utf-8"),
          });
        });

        stream.on("end", () => {
          socket.emit("terminal:ended", { sessionId, reason: "process_exit" });
          destroySession(sessionId);
        });

        stream.on("error", () => {
          socket.emit("terminal:ended", { sessionId, reason: "error" });
          destroySession(sessionId);
        });

        // Notify client that session is ready
        socket.emit("terminal:ready", { sessionId, shell });
      } catch (err: any) {
        socket.emit("terminal:error", {
          sessionId,
          error: `Failed to start terminal: ${err.message}`,
        });
      }
    },
  );

  socket.on(
    "terminal:input",
    (data: { sessionId: string; data: string }) => {
      const session = sessions.get(data.sessionId);
      if (!session || session.socketId !== socket.id) return;

      resetInactivityTimer(data.sessionId, socket);

      try {
        session.stream.write(data.data);
      } catch {
        // Stream closed
        destroySession(data.sessionId);
        socket.emit("terminal:ended", {
          sessionId: data.sessionId,
          reason: "write_error",
        });
      }
    },
  );

  socket.on(
    "terminal:resize",
    async (data: { sessionId: string; cols: number; rows: number }) => {
      const session = sessions.get(data.sessionId);
      if (!session || session.socketId !== socket.id) return;

      try {
        await session.exec.resize({ h: data.rows, w: data.cols });
      } catch {
        // Resize not supported or exec ended
      }
    },
  );

  socket.on("terminal:stop", (data: { sessionId: string }) => {
    const session = sessions.get(data.sessionId);
    if (!session || session.socketId !== socket.id) return;

    destroySession(data.sessionId);
    socket.emit("terminal:ended", { sessionId: data.sessionId, reason: "user" });
  });

  socket.on("disconnect", () => {
    for (const [sessionId, session] of sessions) {
      if (session.socketId === socket.id) {
        destroySession(sessionId);
      }
    }
  });
}
