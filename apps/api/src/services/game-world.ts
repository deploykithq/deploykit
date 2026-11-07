import * as path from "path";

import { validateWorldValues } from "@deploykit/shared";

import { getGame } from "./game-catalog";
import { execIn, MOUNT_ROOT } from "./game-files";
import { allValues, GameServerError } from "./game-server";

import type Docker from "dockerode";
import type { GameSpecT, GameValueT, GameVariableT, GameWorldT } from "@deploykit/shared";
import type { GameServerT } from "../db/schema/index";

/**
 * "Regenerate world": throw away exactly the paths a game declares as its
 * world (`spec.world`) so the game generates a new one on its next start,
 * leaving mods, mod configs and everything else on the volume alone.
 *
 * The world's creation variables (seed, size) are not `editable` — changing
 * them under an existing world does nothing — but they may be set again here,
 * since this is the one moment they take effect.
 *
 * The job itself runs on the `game-backup` queue (game-backup.worker.ts),
 * after a safety backup that is never optional.
 */

type WorldRowT = Pick<GameServerT, "gameId" | "spec">;

const NOTHING_TO_BACK_UP = /^Nothing to back up yet/;

/**
 * The server's world block. The spec is a snapshot, so a server created
 * before its game declared one falls back to the catalogue's — but only when
 * both run the same image contract, so the paths mean the same thing, and
 * only with the parts that fit the snapshot (its volume, its variables).
 */
const worldFor = async (row: WorldRowT): Promise<GameWorldT | null> => {
  if (row.spec.world) return row.spec.world;
  if (row.spec.contract === undefined) return null;
  const game = await getGame(row.gameId).catch(() => null);
  if (!game?.world || game.contract !== row.spec.contract) return null;
  if (!row.spec.volumes.some((v) => v.name === game.world!.volume)) return null;
  const declared = new Set(row.spec.variables.filter((v) => !v.secret).map((v) => v.key));
  return { ...game.world, variables: game.world.variables.filter((k) => declared.has(k)) };
};

/** What the form needs: the world's variables and their current values. */
const worldInfo = async (row: WorldRowT & Pick<GameServerT, "config" | "secretConfig">) => {
  const world = await worldFor(row);
  if (!world) {
    return {
      available: false as const,
      reason: "This game does not declare where its world lives, so it cannot be regenerated",
    };
  }
  const values = allValues(row);
  const variables: GameVariableT[] = world.variables
    .map((key) => row.spec.variables.find((v) => v.key === key))
    .filter((v): v is GameVariableT => Boolean(v));
  return {
    available: true as const,
    volume: world.volume,
    paths: world.paths,
    variables,
    values: Object.fromEntries(variables.map((v) => [v.key, values[v.key] ?? ""])),
  };
};

/** Validate the new creation values; throws BAD_REQUEST with every problem. */
const checkWorldValues = (
  spec: Pick<GameSpecT, "variables">,
  world: GameWorldT,
  input: Record<string, GameValueT | null | undefined>,
  current: Record<string, string>,
): Record<string, string> => {
  const checked = validateWorldValues({ variables: spec.variables, world }, input, current);
  const errors = Object.entries(checked.errors);
  if (errors.length > 0) {
    const label = (key: string) => spec.variables.find((v) => v.key === key)?.label ?? key;
    throw new GameServerError(
      "BAD_REQUEST",
      errors.map(([key, message]) => `${label(key)}: ${message}`).join("; "),
    );
  }
  return checked.values;
};

/**
 * Deleting the world needs the safety backup queued ahead of the job to have
 * worked — or to have found no world at all, in which case nothing is lost.
 */
const mayRegenerate = (
  backup: { status: string; error: string | null } | null,
): { ok: true } | { ok: false; reason: string } => {
  if (!backup) return { ok: false, reason: "The safety backup is missing" };
  if (backup.status === "success" || NOTHING_TO_BACK_UP.test(backup.error ?? "")) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `The safety backup failed, so the world was not deleted: ${backup.error ?? "unknown error"}`,
  };
};

/**
 * Empty the world's paths through a helper that mounts its volume under
 * MOUNT_ROOT. A directory keeps existing (games create files in it, and its
 * owner is the game's user); a missing path is fine. `find -delete` and
 * `rm` never follow a symlink out of the volume.
 */
const clearWorld = async (helper: Docker.Container, world: GameWorldT): Promise<void> => {
  for (const p of world.paths) {
    const target = path.posix.join(MOUNT_ROOT, world.volume, p);
    // Validated by the schema; checked again because this deletes.
    if (!target.startsWith(`${MOUNT_ROOT}/${world.volume}/`)) {
      throw new Error(`Refusing to clear ${p}: outside the volume`);
    }
    const isDir = (await execIn(helper, ["test", "-d", target])).exitCode === 0;
    const cmd = isDir
      ? ["find", target, "-mindepth", "1", "-delete"]
      : ["rm", "-f", "--", target];
    const result = await execIn(helper, cmd);
    if (result.exitCode !== 0) {
      throw new Error(`Could not clear ${p}: ${result.stderr.trim()}`);
    }
  }
};

export { worldFor, worldInfo, checkWorldValues, mayRegenerate, clearWorld, type WorldRowT };
