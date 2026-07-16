import { and, eq, gt, inArray } from "drizzle-orm";

import { db } from "../db/index";
import { deployments } from "../db/schema/index";

import { redis } from "./redis";

/**
 * Per-application deploy serialization.
 *
 * Two deploy executions for the same app running concurrently destroy each
 * other's containers (each starts with removeServiceContainers) and can leave
 * the surviving container without its configured volumes. This module provides
 * the two guards used to prevent that:
 *
 * - `hasActiveDeployment` — request-time check so the UI gets an immediate
 *   CONFLICT instead of queueing a redundant deploy.
 * - `withDeployLock` — Redis mutex held by the worker for the whole job, so
 *   jobs that do get queued concurrently (webhooks, races) run one at a time.
 */

// Ignore in-flight rows older than this: a crashed worker must not block the
// app's deploys forever.
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

const ACTIVE_STATUSES = ["queued", "building", "deploying"];

const hasActiveDeployment = async (applicationId: string): Promise<boolean> => {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const row = await db.query.deployments.findFirst({
    where: and(
      eq(deployments.applicationId, applicationId),
      inArray(deployments.status, ACTIVE_STATUSES),
      gt(deployments.createdAt, cutoff),
    ),
    columns: { id: true },
  });
  return !!row;
};

// Generous TTL: must outlive the slowest build (nixpacks/pack cap at 600s)
// plus health checks. Expiry only matters if the process dies mid-deploy.
const LOCK_TTL_SEC = 30 * 60;
const POLL_MS = 5_000;
const WAIT_LIMIT_MS = 30 * 60 * 1000;

// Delete the lock only if we still own it (token match), never a successor's.
const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

const lockKey = (applicationId: string) => `lock:deploy:${applicationId}`;

/**
 * Block until this app's deploy lock is acquired (or the wait limit passes).
 * `token` identifies the holder so release can't drop a successor's lock.
 */
const acquireDeployLock = async (
  applicationId: string,
  token: string,
  onWait?: () => void,
): Promise<void> => {
  const key = lockKey(applicationId);
  const deadline = Date.now() + WAIT_LIMIT_MS;
  let waited = false;

  while ((await redis.set(key, token, "EX", LOCK_TTL_SEC, "NX")) !== "OK") {
    if (!waited) {
      waited = true;
      onWait?.();
    }
    if (Date.now() > deadline) {
      throw new Error(
        "Timed out waiting for a concurrent deployment of this application to finish",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
};

/** Single non-blocking acquisition attempt — for HTTP handlers (rollback). */
const tryAcquireDeployLock = async (
  applicationId: string,
  token: string,
): Promise<boolean> => {
  const result = await redis.set(
    lockKey(applicationId),
    token,
    "EX",
    LOCK_TTL_SEC,
    "NX",
  );
  return result === "OK";
};

/** No-op when the lock is not held by `token` (expired or never acquired). */
const releaseDeployLock = async (
  applicationId: string,
  token: string,
): Promise<void> => {
  await redis
    .eval(RELEASE_SCRIPT, 1, lockKey(applicationId), token)
    .catch(() => {});
};

export {
  hasActiveDeployment,
  acquireDeployLock,
  tryAcquireDeployLock,
  releaseDeployLock,
};
