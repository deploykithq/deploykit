import IORedis from "ioredis";
import { Queue } from "bullmq";
import { resolve } from "path";
import { config } from "dotenv";

config({ path: resolve(import.meta.dirname, "../../../../.env") });

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const RT_PREFIX = "rt:";
const RT_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

const deployQueue = new Queue("deploy", {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 20 },
    attempts: 1,
  },
});

// Stacks get their own queue: a Compose deploy is pull + up, with no image
// build, so it must not queue behind long application builds.
const composeDeployQueue = new Queue("compose-deploy", {
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

const refreshTokenStore = {
  async set(token: string, userId: string): Promise<void> {
    await redis.set(`${RT_PREFIX}${token}`, userId, "EX", RT_TTL_SEC);
  },

  async get(token: string): Promise<string | null> {
    return redis.get(`${RT_PREFIX}${token}`);
  },

  async del(token: string): Promise<void> {
    await redis.del(`${RT_PREFIX}${token}`);
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
  redis,
  deployQueue,
  composeDeployQueue,
  backupQueue,
  isRateLimited,
};
