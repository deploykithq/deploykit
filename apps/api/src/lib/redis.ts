import IORedis from "ioredis";
import { Queue } from "bullmq";
import { resolve } from "path";
import { config } from "dotenv";

config({ path: resolve(import.meta.dirname, "../../../../.env") });

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const RT_PREFIX = "rt:";
const RT_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const RV_PREFIX = "rv:";
const ACCESS_TTL_SEC = 15 * 60; // must match the access token's expiry

const deployQueue = new Queue("deploy", {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 20 },
    attempts: 1,
  },
});

const backupQueue = new Queue("backup", {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  },
});

/**
 * Refresh token whitelist. Keyed by the sha256 of the token, never the token
 * itself, so a `sessions` row (which only stores the hash) is enough to evict
 * a session — and no raw JWT ever sits in Redis.
 */
const refreshTokenStore = {
  async set(tokenHash: string, userId: string): Promise<void> {
    await redis.set(`${RT_PREFIX}${tokenHash}`, userId, "EX", RT_TTL_SEC);
  },

  async get(tokenHash: string): Promise<string | null> {
    return redis.get(`${RT_PREFIX}${tokenHash}`);
  },

  async del(tokenHash: string): Promise<void> {
    await redis.del(`${RT_PREFIX}${tokenHash}`);
  },
};

/**
 * Revocation list for access tokens. Access tokens are stateless JWTs, so a
 * revoked session would otherwise keep working until its 15 minutes are up.
 * Marking the session id here makes the cut immediate: every request checks it.
 *
 * Entries expire with the access token itself — past that point no token
 * carrying the id can still verify, so the marker has nothing left to block.
 */
const revokedSessionStore = {
  async mark(sessionId: string): Promise<void> {
    await redis.set(`${RV_PREFIX}${sessionId}`, "1", "EX", ACCESS_TTL_SEC);
  },

  async isRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await redis.get(`${RV_PREFIX}${sessionId}`)) !== null;
    } catch (err) {
      // Fails open, like the rate limiter: a Redis outage must not lock
      // everyone out. The revoked session survives at most one token lifetime.
      console.error("[sessions] Redis unreachable on revocation check:", err);
      return false;
    }
  },
};

/**
 * Distributed fixed-window rate limiter backed by Redis, so limits hold
 * across multiple API processes. Returns true when the request exceeds
 * maxRequests within windowMs. Fails open if Redis is unreachable.
 */
const isRateLimited = async (
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<boolean> => {
  const redisKey = `rl:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.pexpire(redisKey, windowMs);
    }
    return count > maxRequests;
  } catch {
    // Don't take the API down if Redis hiccups
    return false;
  }
};

export {
  refreshTokenStore,
  revokedSessionStore,
  redis,
  deployQueue,
  backupQueue,
  isRateLimited,
  RT_TTL_SEC as REFRESH_TOKEN_TTL_SEC,
  ACCESS_TTL_SEC as ACCESS_TOKEN_TTL_SEC,
};
