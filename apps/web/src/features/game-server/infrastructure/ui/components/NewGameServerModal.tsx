import { memo } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";

import { GameCatalogPicker } from "@game-server/infrastructure/ui/components/GameCatalogPicker";
import { GamePortsFields } from "@game-server/infrastructure/ui/components/GamePortsFields";
import { GameServerForm } from "@game-server/infrastructure/ui/components/GameServerForm";
import { ModpackPicker } from "@game-server/infrastructure/ui/components/ModpackPicker";
import { GeneratedSecretsView } from "@game-server/infrastructure/ui/components/GeneratedSecretsView";
import { MemoryField } from "@game-server/infrastructure/ui/components/MemoryField";

import { useNewGameServer } from "@game-server/infrastructure/ui/hooks/useNewGameServer";

import type { NewGameServerModalPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

export const NewGameServerModal: React.FC<NewGameServerModalPropsI> = memo(
  function NewGameServerModal({ open, onClose, projectId }) {
    const {
      game,
      spec,
      specLoading,
      specError,
      name,
      setName,
      nameError,
      form,
      modpack,
      setModpack,
      modpackHides,
      created,
      creating,
      createError,
      selectGame,
      back,
      close,
      handleSubmit,
      goToServer,
    } = useNewGameServer(projectId, onClose);

    const title = created
      ? "Game server created"
      : game
        ? `New ${game.name} server`
        : "New game server";

    return (
      <Modal open={open} onClose={close} title={title}>
        {created ? (
          <GeneratedSecretsView
            secrets={created.generatedSecrets}
            onContinue={() => goToServer(created.id)}
          />
        ) : !game ? (
          <GameCatalogPicker onSelect={selectGame} />
        ) : specLoading ? (
          <div className="flex items-center justify-center h-40 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : !spec ? (
          <div className="space-y-3">
            <p className="text-sm text-danger">
              {specError ?? "Could not load this game's definition."}
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={back}>
              <ArrowLeft className="w-3.5 h-3.5" /> Choose another game
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <button
              type="button"
              onClick={back}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Choose another game
            </button>

            <div className="space-y-1">
              <Input
                label="Server name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={game.id}
                maxLength={41}
                autoFocus
                autoComplete="off"
              />
              {nameError ? (
                <p className="text-xs text-danger">{nameError}</p>
              ) : (
                <p className="text-[11px] text-text-muted">
                  Lowercase letters, digits and hyphens. Names the container
                  and its volumes.
                </p>
              )}
            </div>

            {(spec.mods?.modpacks.length ?? 0) > 0 && (
              <section className="space-y-3">
                <ModpackPicker gameId={spec.id} value={modpack} onChange={setModpack} />
              </section>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-medium">Settings</h3>
              <GameServerForm
                spec={spec}
                values={form.values}
                errors={form.errors}
                onChange={form.setValue}
                mode="create"
                hiddenKeys={modpackHides}
              />
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">Ports</h3>
              <GamePortsFields
                spec={spec}
                ports={form.ports}
                errors={form.portErrors}
                onChange={form.setPort}
              />
            </section>

            <section className="space-y-1">
              <MemoryField
                min={spec.resources.memoryMb.min}
                recommended={spec.resources.memoryMb.recommended}
                value={form.memoryMb}
                onChange={form.setMemoryMb}
              />
              {form.memoryError && (
                <p className="text-xs text-danger">{form.memoryError}</p>
              )}
            </section>

            {createError && (
              <p role="alert" className="text-xs text-danger whitespace-pre-wrap">
                {createError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create game server"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    );
  },
);
