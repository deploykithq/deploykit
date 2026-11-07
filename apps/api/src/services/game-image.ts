import { docker } from "../lib/docker";

import { getGame } from "./game-catalog";
import {
  allValues,
  loadGameServerPorts,
  resolveImage,
  substitutionValues,
} from "./game-server";

import type { GameSpecT } from "@deploykit/shared";
import type { GameServerT } from "../db/schema/index";

/**
 * "Update image": move a game server to the image its game uses now.
 *
 * Two things can make a server's image old, and both are checked:
 *
 * - **A new tag.** The spec is a snapshot, so a server keeps the tag it was
 *   created with (`game-tmodloader:0.1`) after the catalogue moves on
 *   (`:0.2`). Only `spec.image` is taken from the catalogue, and only when
 *   both run the same image contract: anything else in the definition can
 *   change what the container is, and the snapshot rule stands for it.
 * - **A new build of the same tag.** `createAndStart` pulls only an image
 *   that is not on the host, so a floating tag is never refreshed by itself.
 *   The registry's digest for the tag is compared with the image the
 *   container actually runs.
 *
 * The update itself runs on the `game-backup` queue (game-backup.worker.ts).
 */

type ImageRowT = Pick<
  GameServerT,
  "id" | "name" | "gameId" | "spec" | "memoryMb" | "config" | "secretConfig" | "containerId"
>;

interface ImageCheckI {
  /** The image the server is configured with, resolved. */
  current: string;
  /** The image an update would run, resolved. */
  target: string;
  /** The catalogue's `image` when it differs from the snapshot, else null. */
  specImage: string | null;
  /** The registry has a different build of `target` than the one running; null = unknown. */
  newBuild: boolean | null;
  available: boolean;
}

const NOTHING_TO_BACK_UP = /^Nothing to back up yet/;

const resolveFor = async (row: ImageRowT, spec: GameSpecT): Promise<string> =>
  resolveImage(
    spec,
    substitutionValues(row, allValues(row), await loadGameServerPorts(row.id)),
  );

/**
 * The catalogue's image for this server, if it moved and still fits: same
 * contract, and it resolves with the snapshot's own variables (a reference
 * the snapshot does not declare would leave `${x}` in the reference).
 */
const catalogueImage = async (row: ImageRowT): Promise<string | null> => {
  if (row.spec.contract === undefined) return null;
  const game = await getGame(row.gameId).catch(() => null);
  if (!game || game.contract !== row.spec.contract || game.image === row.spec.image) return null;
  try {
    await resolveFor(row, { ...row.spec, image: game.image });
    return game.image;
  } catch {
    return null;
  }
};

/** Digests (`sha256:…`) the running container's image is known by. */
const runningDigests = async (containerId: string): Promise<string[] | null> => {
  try {
    const info = await docker.getContainer(containerId).inspect();
    const image = await docker.getImage(info.Image).inspect();
    return (image.RepoDigests ?? []).map((d) => d.split("@")[1]!).filter(Boolean);
  } catch {
    return null;
  }
};

/** The registry's digest for a tag, without pulling it. */
const remoteDigest = async (image: string): Promise<string | null> => {
  try {
    const info: any = await (docker.getImage(image) as any).distribution();
    return info?.Descriptor?.digest ?? null;
  } catch {
    return null;
  }
};

/** Whether `remote` differs from what runs; null when either is unknown. */
const isNewBuild = (running: string[] | null, remote: string | null): boolean | null => {
  if (!running || !remote) return null;
  return !running.includes(remote);
};

const checkImageUpdate = async (row: ImageRowT): Promise<ImageCheckI> => {
  const current = await resolveFor(row, row.spec);
  const specImage = await catalogueImage(row);
  const target = specImage ? await resolveFor(row, { ...row.spec, image: specImage }) : current;
  const newBuild =
    !specImage && row.containerId
      ? isNewBuild(await runningDigests(row.containerId), await remoteDigest(target))
      : null;
  return {
    current,
    target,
    specImage,
    newBuild,
    available: Boolean(specImage) || newBuild === true,
  };
};

/** The update needs the safety backup ahead of it (when one was asked for) to have worked. */
const mayUpdateImage = (
  backup: { status: string; error: string | null } | null,
): { ok: true } | { ok: false; reason: string } => {
  if (!backup) return { ok: true };
  if (backup.status === "success" || NOTHING_TO_BACK_UP.test(backup.error ?? "")) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `The safety backup failed, so the image was not updated: ${backup.error ?? "unknown error"}`,
  };
};

export {
  checkImageUpdate,
  catalogueImage,
  isNewBuild,
  mayUpdateImage,
  resolveFor,
  type ImageCheckI,
  type ImageRowT,
};
