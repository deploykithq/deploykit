import { useEffect, useMemo, useState } from "react";

import { trpc } from "@lib/trpc";

import {
  baseName,
  downloadWithAuth,
  joinPath,
  parentPath,
  uploadWithProgress,
} from "@game-server/infrastructure/ui/utils/game-server.utils";

import type { GameServerDetailT } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

interface UploadStateI {
  name: string;
  progress: number;
}

/**
 * The Files tab: browse a volume, edit text files, and move files in and out.
 *
 * Small operations go through tRPC; uploads and downloads stream through
 * `/api/game-servers/:id/files/*`, which tRPC's 1 MiB JSON bodies could not
 * carry.
 */
export const useGameFiles = (server: GameServerDetailT, enabled: boolean) => {
  const utils = trpc.useUtils();

  const volumes = useMemo(
    () => server.spec.volumes.filter((v) => v.browsable),
    [server.spec.volumes],
  );

  const [volume, setVolumeState] = useState<string>(
    () => volumes.find((v) => v.primary)?.name ?? volumes[0]?.name ?? "",
  );
  const [path, setPath] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadStateI | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  useEffect(() => {
    if (!volumes.some((v) => v.name === volume) && volumes[0]) {
      setVolumeState(volumes[0].name);
    }
  }, [volumes, volume]);

  const listQuery = trpc.gameServer.files.list.useQuery(
    { id: server.id, volume, path },
    { enabled: enabled && !!volume },
  );

  const invalidateList = () =>
    utils.gameServer.files.list.invalidate({ id: server.id, volume });

  const mkdirMutation = trpc.gameServer.files.mkdir.useMutation({
    onSuccess: invalidateList,
  });
  const deleteMutation = trpc.gameServer.files.delete.useMutation({
    onSuccess: invalidateList,
  });
  const renameMutation = trpc.gameServer.files.rename.useMutation({
    onSuccess: invalidateList,
  });

  const setVolume = (name: string) => {
    setVolumeState(name);
    setPath("");
    setEditing(null);
  };

  /** Open a config-file shortcut: jump to its folder and open the editor. */
  const openFile = (vol: string, filePath: string) => {
    setVolumeState(vol);
    setPath(parentPath(filePath));
    setEditing(filePath);
  };

  const uploadFiles = async (files: FileList | File[]) => {
    setTransferError(null);
    for (const file of Array.from(files)) {
      setUpload({ name: file.name, progress: 0 });
      try {
        const qs = new URLSearchParams({ volume, path, name: file.name });
        await uploadWithProgress(
          `/api/game-servers/${server.id}/files/upload?${qs.toString()}`,
          file,
          (progress) => setUpload({ name: file.name, progress }),
        );
      } catch (err) {
        setTransferError(
          `${file.name}: ${err instanceof Error ? err.message : "Upload failed"}`,
        );
        break;
      }
    }
    setUpload(null);
    invalidateList();
  };

  const download = async (target: string, isDirectory: boolean) => {
    setTransferError(null);
    try {
      const qs = new URLSearchParams({ volume, path: target });
      const fallback = `${baseName(target) || volume}${isDirectory ? ".tar.gz" : ""}`;
      await downloadWithAuth(
        `/api/game-servers/${server.id}/files/download?${qs.toString()}`,
        fallback,
      );
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const mutationError =
    mkdirMutation.error?.message ??
    deleteMutation.error?.message ??
    renameMutation.error?.message ??
    null;

  return {
    volumes,
    volume,
    setVolume,
    path,
    setPath,
    entries: listQuery.data?.entries ?? [],
    truncated: listQuery.data?.truncated ?? false,
    loading: listQuery.isLoading && enabled,
    listError: listQuery.error?.message ?? null,
    refresh: () => listQuery.refetch(),
    editing,
    setEditing,
    openFile,
    mkdir: (name: string) =>
      mkdirMutation.mutateAsync({ id: server.id, volume, path, name }),
    remove: (target: string) =>
      deleteMutation.mutateAsync({ id: server.id, volume, path: target }),
    rename: (target: string, newName: string) =>
      renameMutation.mutateAsync({
        id: server.id,
        volume,
        path: target,
        to: joinPath(parentPath(target), newName),
      }),
    mutating:
      mkdirMutation.isPending || deleteMutation.isPending || renameMutation.isPending,
    mutationError,
    upload,
    uploadFiles,
    download,
    transferError,
  };
};
