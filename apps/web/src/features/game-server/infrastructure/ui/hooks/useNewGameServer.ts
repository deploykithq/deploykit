import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { GAME_SERVER_NAME_REGEX } from "@deploykit/shared";

import { trpc } from "@lib/trpc";

import { useGameForm } from "@game-server/infrastructure/ui/hooks/useGameForm";

import type {
  GameCatalogEntryT,
  ModpackChoiceI,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

interface CreatedServerI {
  id: string;
  generatedSecrets: Record<string, string>;
}

/**
 * The two-step "new game server" flow: pick a game, then fill its form. When
 * the API generated secrets (an RCON password left blank), they are shown once
 * before moving on to the server's page.
 */
export const useNewGameServer = (projectId: string, onClose: () => void) => {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [game, setGame] = useState<GameCatalogEntryT | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedServerI | null>(null);
  const [modpack, setModpack] = useState<ModpackChoiceI | null>(null);

  const specQuery = trpc.gameServer.catalog.byId.useQuery(
    { id: game?.id ?? "" },
    { enabled: !!game },
  );
  const spec = specQuery.data;

  const form = useGameForm({ spec, mode: "create" });

  const goToServer = (id: string) => {
    close();
    navigate({
      to: "/projects/$projectId/games/$gameServerId",
      params: { projectId, gameServerId: id },
    });
  };

  const createMutation = trpc.gameServer.create.useMutation({
    onSuccess: (result) => {
      utils.project.byId.invalidate({ id: projectId });
      if (Object.keys(result.generatedSecrets ?? {}).length > 0) {
        setCreated({ id: result.id, generatedSecrets: result.generatedSecrets });
      } else {
        goToServer(result.id);
      }
    },
  });

  const close = () => {
    setGame(null);
    setName("");
    setNameError(null);
    setCreated(null);
    setModpack(null);
    createMutation.reset();
    onClose();
  };

  const selectGame = (entry: GameCatalogEntryT) => {
    setGame(entry);
    setModpack(null);
    if (!name) setName(entry.id.slice(0, 41));
    createMutation.reset();
  };

  const back = () => {
    setGame(null);
    createMutation.reset();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!game || !spec) return;

    const trimmed = name.trim();
    const badName = !GAME_SERVER_NAME_REGEX.test(trimmed);
    setNameError(
      badName
        ? "Lowercase letters, digits and hyphens; start with a letter or digit (max 41)"
        : null,
    );

    const payload = form.buildPayload();
    if (badName || !payload) return;

    createMutation.mutate({
      projectId,
      name: trimmed,
      gameId: game.id,
      values: payload.values,
      ports: payload.ports,
      memoryMb: payload.memoryMb,
      ...(modpack
        ? { modpack: { source: modpack.source, ref: modpack.ref, versionId: modpack.versionId } }
        : {}),
    });
  };

  return {
    game,
    spec,
    specLoading: specQuery.isLoading && !!game,
    specError: specQuery.error?.message ?? null,
    name,
    setName,
    nameError,
    form,
    modpack,
    setModpack,
    // While a modpack is chosen, it decides the loader and game version.
    modpackHides: modpack
      ? [spec?.mods?.loader?.from, spec?.mods?.gameVersion?.from].filter(
          (k): k is string => Boolean(k),
        )
      : [],
    created,
    creating: createMutation.isPending,
    createError: createMutation.error?.message ?? null,
    selectGame,
    back,
    close,
    handleSubmit,
    goToServer,
  };
};
