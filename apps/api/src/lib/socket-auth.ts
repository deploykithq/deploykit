import jwt from "jsonwebtoken";
import { eq, or } from "drizzle-orm";

import {
  users,
  applications,
  databases,
  deployments,
  composeServices,
} from "../db/schema/index";
import { db } from "../db/index";

import { getProjectRole } from "./permissions";

import type { UserT } from "../db/schema/index";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verify a socket JWT and resolve the full user record.
 * Returns null on any failure (missing/invalid/expired token, unknown user).
 */
const verifySocketAuth = async (
  token: string | undefined,
): Promise<UserT | null> => {
  if (!token || typeof token !== "string") return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!, {
      algorithms: ["HS256"],
    }) as { userId: string };

    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
    });
    return user ?? null;
  } catch {
    return null;
  }
};

/**
 * Resolve the owning project of an application, database or Compose stack,
 * referenced either by its own UUID (serviceId) or by its Docker container id.
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
  if (database) return database.projectId;

  // A Compose stack owns many containers and stores none of their ids, so it
  // is only ever addressed by its own UUID. Its containers are reachable
  // because they carry the `deploykit.service=<stack id>` label.
  if (!isUuid) return null;
  const stack = await db.query.composeServices.findFirst({
    where: eq(composeServices.id, ref),
    columns: { projectId: true },
  });
  return stack?.projectId ?? null;
};

/**
 * Can this user view the project that owns the given deployment?
 *
 * A deployment belongs to either an application or a Compose stack (never
 * both), so resolve whichever owner it actually has. Treating a stack
 * deployment as an application one would deny its own project's members.
 */
const canViewDeployment = async (
  user: UserT,
  deploymentId: string,
): Promise<boolean> => {
  if (!UUID_RE.test(deploymentId)) return false;

  const deployment = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    columns: { applicationId: true, composeServiceId: true },
  });
  if (!deployment) return false;

  let projectId: string | undefined;

  if (deployment.applicationId) {
    const app = await db.query.applications.findFirst({
      where: eq(applications.id, deployment.applicationId),
      columns: { projectId: true },
    });
    projectId = app?.projectId;
  } else if (deployment.composeServiceId) {
    const stack = await db.query.composeServices.findFirst({
      where: eq(composeServices.id, deployment.composeServiceId),
      columns: { projectId: true },
    });
    projectId = stack?.projectId;
  }

  if (!projectId) return false;

  return (await getProjectRole(user, projectId)) !== null;
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

export { verifySocketAuth, canViewDeployment, canViewService };
