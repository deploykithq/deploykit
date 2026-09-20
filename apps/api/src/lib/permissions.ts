import { eq, and } from "drizzle-orm";

import { db } from "../db/index";
import {
  projectMembers,
  applications,
  databases,
  composeServices,
} from "../db/schema/index";

import type { UserT } from "../db/schema/index";
import type { UserRole } from "@deploykit/shared";

const ROLE_LEVEL: Record<string, number> = {
  admin: 3,
  operator: 2,
  viewer: 1,
};

/**
 * Returns the effective role for a user within a specific project,
 * or null when the user has no access to that project at all.
 *
 * Rules:
 *  1. Global admin → always admin (superadmin, cannot be downgraded per-project)
 *  2. If user has a project_members entry → use that role
 *  3. Otherwise → no access (membership is required; the global role only
 *     gates instance-level actions such as creating projects or servers)
 */
const getProjectRole = async (
  user: UserT,
  projectId: string,
): Promise<UserRole | null> => {
  // Global admins are always admin everywhere
  if (user.role === "admin") return "admin";

  // Check for per-project membership
  const member = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, user.id),
    ),
  });

  if (member) return member.role as UserRole;

  return null;
};

// Resolve role from an application ID (looks up the app's projectId first).
const getProjectRoleByAppId = async (
  user: UserT,
  applicationId: string,
): Promise<UserRole | null> => {
  if (user.role === "admin") return "admin";

  const app = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
    columns: { projectId: true },
  });

  if (!app) return null;
  return getProjectRole(user, app.projectId);
};

// Resolve role from a database ID (looks up the db's projectId first).
const getProjectRoleByDbId = async (
  user: UserT,
  databaseId: string,
): Promise<UserRole | null> => {
  if (user.role === "admin") return "admin";

  const database = await db.query.databases.findFirst({
    where: eq(databases.id, databaseId),
    columns: { projectId: true },
  });

  if (!database) return null;
  return getProjectRole(user, database.projectId);
};

// Resolve role from a Compose stack ID (looks up the stack's projectId first).
const getProjectRoleByComposeId = async (
  user: UserT,
  composeServiceId: string,
): Promise<UserRole | null> => {
  if (user.role === "admin") return "admin";

  const stack = await db.query.composeServices.findFirst({
    where: eq(composeServices.id, composeServiceId),
    columns: { projectId: true },
  });

  if (!stack) return null;
  return getProjectRole(user, stack.projectId);
};

// IDs of all projects the user can see (all projects for global admins, member projects otherwise).
const getAccessibleProjectIds = async (user: UserT): Promise<string[]> => {
  const memberships = await db.query.projectMembers.findMany({
    where: eq(projectMembers.userId, user.id),
    columns: { projectId: true },
  });
  return memberships.map((m) => m.projectId);
};

// Permission checks (null role = no access to the project)
const canView = (role: UserRole | null): boolean => {
  return role !== null;
};

const canOperate = (role: UserRole | null): boolean => {
  if (!role) return false;
  return ROLE_LEVEL[role]! >= ROLE_LEVEL["operator"]!;
};

const isAdmin = (role: UserRole | null): boolean => {
  return role === "admin";
};

const canViewSecrets = (role: UserRole | null): boolean => {
  return role === "admin" || role === "operator";
};

export {
  getProjectRole,
  getProjectRoleByAppId,
  getProjectRoleByDbId,
  getProjectRoleByComposeId,
  getAccessibleProjectIds,
  canView,
  canOperate,
  isAdmin,
  canViewSecrets,
};
