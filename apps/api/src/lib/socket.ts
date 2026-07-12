import { Server as SocketServer } from "socket.io";

import { registerTerminalHandlers } from "../services/terminal";

import {
  verifySocketAuth,
  canViewDeployment,
  canViewService,
} from "./socket-auth";

import type { UserI } from "../db/schema/index";
import type { Server as HttpServer } from "http";

let io: SocketServer | null = null;

interface LogStreamHooks {
  /** Called after an authorized client joins a container log room. */
  onLogsSubscribed?: (containerId: string) => Promise<void> | void;
  /** Called after a client leaves a log room; roomEmpty signals no listeners left. */
  onLogsUnsubscribed?: (containerId: string, roomEmpty: boolean) => void;
}

const initSocket = (
  httpServer: HttpServer,
  logHooks: LogStreamHooks = {},
): SocketServer => {
  if (!process.env.WEB_URL && process.env.NODE_ENV === "production") {
    console.warn(
      "[socket] WEB_URL is not set — Socket.IO CORS will default to http://localhost:5173",
    );
  }

  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.WEB_URL || "http://localhost:5173",
      credentials: true,
    },
    path: "/ws",
  });

  // Every connection must present a valid JWT in the handshake.
  io.use(async (socket, next) => {
    const user = await verifySocketAuth(socket.handshake.auth?.token);
    if (!user) {
      next(new Error("Unauthorized"));
      return;
    }
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as UserI;
    console.log(`[socket] Client connected: ${socket.id} (user ${user.id})`);

    // Join deployment room for real-time logs
    socket.on("subscribe:deployment", async (deploymentId: string) => {
      if (typeof deploymentId !== "string") return;
      if (!(await canViewDeployment(user, deploymentId))) return;
      socket.join(`deployment:${deploymentId}`);
    });

    socket.on("unsubscribe:deployment", (deploymentId: string) => {
      socket.leave(`deployment:${deploymentId}`);
    });

    // Join container room for live logs
    socket.on("subscribe:logs", async (containerId: string) => {
      if (typeof containerId !== "string") return;
      if (!(await canViewService(user, containerId))) return;
      socket.join(`logs:${containerId}`);
      try {
        await logHooks.onLogsSubscribed?.(containerId);
      } catch {
        // Container might not exist
      }
    });

    socket.on("unsubscribe:logs", (containerId: string) => {
      if (typeof containerId !== "string") return;
      socket.leave(`logs:${containerId}`);
      const room = io?.sockets.adapter.rooms.get(`logs:${containerId}`);
      logHooks.onLogsUnsubscribed?.(containerId, !room || room.size === 0);
    });

    // Join service room for live metrics
    socket.on("subscribe:metrics", async (serviceId: string) => {
      if (typeof serviceId !== "string") return;
      if (!(await canViewService(user, serviceId))) return;
      socket.join(`metrics:${serviceId}`);
    });

    socket.on("unsubscribe:metrics", (serviceId: string) => {
      socket.leave(`metrics:${serviceId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[socket] Client disconnected: ${socket.id}`);
    });

    // Terminal (web shell)
    registerTerminalHandlers(socket);
  });

  return io;
};

const getIO = (): SocketServer => {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
};

const emitDeployLog = (deploymentId: string, log: string) => {
  io?.to(`deployment:${deploymentId}`).emit("deploy:log", {
    deploymentId,
    log,
  });
};

const emitDeployStatus = (
  deploymentId: string,
  status: string,
  data?: Record<string, any>,
) => {
  io?.to(`deployment:${deploymentId}`).emit("deploy:status", {
    deploymentId,
    status,
    ...data,
  });
  // Broadcast a minimal payload (ids + status only) so dashboards can
  // refresh without leaking deployment details to unrelated users.
  io?.emit("service:updated", { deploymentId, status });
};

const emitContainerLog = (containerId: string, log: string) => {
  io?.to(`logs:${containerId}`).emit("container:log", { containerId, log });
};

const emitServiceStatus = (serviceId: string, status: string) => {
  io?.emit("service:updated", { serviceId, status });
};

export {
  initSocket,
  getIO,
  emitDeployLog,
  emitDeployStatus,
  emitContainerLog,
  emitServiceStatus,
};
