import { useEffect, useState } from "react";
import { validateWorldValues } from "@deploykit/shared";

import { trpc } from "@lib/trpc";

import type { GameServerDetailT } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * "Regenerate world": what the game calls its world, the creation values
 * (prefilled with the current ones) and the confirmation. Validation runs the
 * same `validateWorldValues` the API runs.
 */
export const useRegenerateWorld = (server: GameServerDetailT, enabled: boolean) => {
  const utils = trpc.useUtils();
  const info = trpc.gameServer.world.info.useQuery({ id: server.id }, { enabled });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmName, setConfirmName] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const data = info.data?.available ? info.data : null;

  useEffect(() => {
    if (open && data) {
      setValues(data.values);
      setErrors({});
      setConfirmName("");
    }
  }, [open, data]);

  const mutation = trpc.gameServer.world.regenerate.useMutation({
    onSuccess: (result) => {
      utils.gameServer.byId.invalidate({ id: server.id });
      utils.gameServer.backups.list.invalidate({ id: server.id });
      utils.gameServer.world.info.invalidate({ id: server.id });
      setOpen(false);
      setNote(
        result.appliesOnStart
          ? "Saved: the world is created with these values on the first start."
          : "Queued: a backup runs first, then the world is deleted and the server starts with a new one.",
      );
    },
  });

  const submit = () => {
    if (!data) return;
    const world = {
      volume: data.volume,
      paths: data.paths,
      variables: data.variables.map((v) => v.key),
    };
    const checked = validateWorldValues({ variables: data.variables, world }, values, data.values);
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length > 0) return;
    mutation.mutate({ id: server.id, values: checked.values });
  };

  return {
    available: Boolean(data),
    canEdit: info.data?.canEdit ?? false,
    unavailableReason: info.data && !info.data.available ? info.data.reason : null,
    paths: data?.paths ?? [],
    variables: data?.variables ?? [],
    values,
    errors,
    setValue: (key: string, value: string | boolean) =>
      setValues((prev) => ({ ...prev, [key]: String(value) })),
    open,
    setOpen,
    confirmName,
    setConfirmName,
    confirmed: confirmName.trim() === server.name,
    submit,
    pending: mutation.isPending,
    error: mutation.error?.message ?? null,
    note,
  };
};
