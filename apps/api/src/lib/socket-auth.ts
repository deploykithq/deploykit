import jwt from "jsonwebtoken";
import { eq, or } from "drizzle-orm";

import {
  users,
  applications,
  databases,
  deployments,
} from "../db/schema/index";
import { db } from "../db/index";

import { getProjectRole } from "./permissions";
import { revokedSessionStore } from "./redis";

import type { UserT } from "../db/schema/index";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verify a socket JWT and resolve both the user and the session it belongs to.
 * Returns null on any failure (missing/invalid/expired token, unknown user, or
 * a session that has been revoked).
 */
const verifySocketSession = async (
  token: string | undefined,
): Promise<{ user: UserT; sessionId: string | null } | null> => {
  if (!token || typeof token !== "string") return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!, {
      algorithms: ["HS256"],
    }) as { userId: string; sid?: string };

    // Tokens minted before sessions existed carry no sid; they simply age out.
    if (payload.sid && (await revokedSessionStore.isRevoked(payload.sid))) {
      return null;
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
    });
    if (!user) return null;

    return { user, sessionId: payload.sid ?? null };
  } catch {
    return null;
  }
};

/** Same check, when only the user record is needed. */
const verifySocketAuth = async (
  token: string | undefined,
): Promise<UserT | null> => (await verifySocketSession(token))?.user ?? null;

/**
 * Resolve the owning project of an application or database, referenced
 * either by its own UUID (serviceId) or by its Docker container id.
 */
const findProjectIdByServiceRef = async (
  ref: string,
): Promise<string | null> => {
  const isUuid = UUID_RE.test(ref);

  const app = await db.query.applications.findFirst({
    where: isUuid
      ? or(eq(applications.id, ref), eq(applications.containerId, ref))
      : eq(applications.containerId, ref),
    columns: { projectId: true },
  });
  if (app) return app.projectId;

  const database = await db.query.databases.findFirst({
    where: isUuid
      ? or(eq(databases.id, ref), eq(databases.containerId, ref))
      : eq(databases.containerId, ref),
    columns: { projectId: true },
  });
  return database?.projectId ?? null;
};

/** Can this user view the project that owns the given deployment? */
const canViewDeployment = async (
  user: UserT,
  deploymentId: string,
): Promise<boolean> => {
  if (!UUID_RE.test(deploymentId)) return false;

  const deployment = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    columns: { applicationId: true },
  });
  if (!deployment) return false;

  const app = await db.query.applications.findFirst({
    where: eq(applications.id, deployment.applicationId),
    columns: { projectId: true },
  });
  if (!app) return false;

  return (await getProjectRole(user, app.projectId)) !== null;
};

/**
 * Can this user view the project that owns the given service
 * (application/database UUID or Docker container id)?
 */
const canViewService = async (user: UserT, ref: string): Promise<boolean> => {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 100) {
    return false;
  }
  const projectId = await findProjectIdByServiceRef(ref);
  if (!projectId) return false;

  return (await getProjectRole(user, projectId)) !== null;
};

export {
  verifySocketAuth,
  verifySocketSession,
  canViewDeployment,
  canViewService,
};
