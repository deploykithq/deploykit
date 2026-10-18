import type { GameSpecT, GameVariableT } from "@deploykit/shared";

import type { AppRouterClientT } from "@lib/trpc";

type GameServerClientT = AppRouterClientT["gameServer"];

/** `gameServer.byId`: the row, its values (secrets masked), ports and connect info. */
type GameServerDetailT = Awaited<ReturnType<GameServerClientT["byId"]["query"]>>;

/** `gameServer.catalog.list`. */
type GameCatalogT = Awaited<
  ReturnType<GameServerClientT["catalog"]["list"]["query"]>
>;
type GameCatalogEntryT = GameCatalogT["games"][number];

type GameBackupT = Awaited<
  ReturnType<GameServerClientT["backups"]["list"]["query"]>
>[number];

type GameFileEntryT = Awaited<
  ReturnType<GameServerClientT["files"]["list"]["query"]>
>["entries"][number];

type GameServerStatusT =
  | "idle"
  | "provisioning"
  | "running"
  | "stopped"
  | "restoring"
  | "error";

type GameServerTabT =
  | "general"
  | "settings"
  | "console"
  | "files"
  | "mods"
  | "backups"
  | "logs"
  | "monitoring";

type ProjectRoleT = "admin" | "operator" | "viewer";

/**
 * Raw form input. Strings for text, number and select fields (so a number
 * field can be momentarily empty while typing), booleans for toggles.
 */
type GameFormValuesT = Record<string, string | boolean>;

/** Host port per base port name, as typed. */
type GamePortInputsT = Record<string, string>;

/** What the caller may do on one server, mirroring the API's two layers. */
interface GameServerPermissionsI {
  projectRole: ProjectRoleT;
  /** Project operator+: start/stop, settings, backups. */
  canOperate: boolean;
  /** Project admin: delete. */
  isAdmin: boolean;
  /** Files and decrypted secrets. */
  canViewSecrets: boolean;
  /** Console commands and file writes: global operator AND project operator. */
  canExecute: boolean;
}

interface GameServerFormPropsI {
  spec: Pick<GameSpecT, "variables">;
  values: GameFormValuesT;
  errors: Record<string, string>;
  onChange: (key: string, value: string | boolean) => void;
  mode: "create" | "update";
  disabled?: boolean;
  /** Variables not to render (decided by a modpack instead). */
  hiddenKeys?: string[];
}

interface GameVariableFieldPropsI {
  variable: GameVariableT;
  value: string | boolean | undefined;
  error?: string;
  onChange: (value: string | boolean) => void;
  mode: "create" | "update";
  disabled?: boolean;
}

interface GamePortsFieldsPropsI {
  spec: Pick<GameSpecT, "ports">;
  ports: GamePortInputsT;
  errors?: Record<string, string>;
  onChange: (name: string, value: string) => void;
  disabled?: boolean;
}

interface MemoryFieldPropsI {
  min: number;
  recommended: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

interface NewGameServerModalPropsI {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

interface GameCatalogPickerPropsI {
  onSelect: (game: GameCatalogEntryT) => void;
}

interface GeneratedSecretsViewPropsI {
  secrets: Record<string, string>;
  /** false when the server was created without starting it. */
  started: boolean;
  onContinue: () => void;
}

interface GameServerTabPropsI {
  server: GameServerDetailT;
  permissions: GameServerPermissionsI;
}

type GameModsListT = Awaited<ReturnType<GameServerClientT["mods"]["list"]["query"]>>;
type GameModT = GameModsListT["mods"][number];
type ModSourceInfoT = Awaited<ReturnType<GameServerClientT["mods"]["sources"]["query"]>>[number];
type ModSearchHitT = Awaited<
  ReturnType<GameServerClientT["mods"]["search"]["query"]>
>["hits"][number];
type ModSourceIdT = ModSourceInfoT["id"];

/** A modpack picked in the catalogue, before the API resolves it. */
interface ModpackChoiceI {
  source: ModSourceIdT;
  ref: string;
  versionId?: string;
  name: string;
}

interface AddModsModalPropsI {
  open: boolean;
  onClose: () => void;
  sources: ModSourceInfoT[];
  /** "mods": add to `serverId`. "modpack": pick one for `gameId`. */
  mode: "mods" | "modpack";
  serverId?: string;
  gameId?: string;
  onPickModpack?: (pick: ModpackChoiceI) => void;
}

interface ModRowPropsI {
  mod: GameModT;
  update: { versionId: string; label: string } | undefined;
  canEdit: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onUpdate: () => void;
}

interface ModpackCardPropsI {
  modpack: GameModsListT["modpack"];
  canEdit: boolean;
  hasModpackSources: boolean;
  busy: boolean;
  onChange: () => void;
  onRemove: () => void;
}

interface ModpackPickerPropsI {
  gameId: string;
  value: ModpackChoiceI | null;
  onChange: (value: ModpackChoiceI | null) => void;
}

interface GameServerCardItemI {
  id: string;
  name: string;
  gameName: string;
  status: string;
  updatedAt: string | Date;
  ports: { name: string; protocol: string; containerPort: number; hostPort: number }[];
}

export type {
  GameServerDetailT,
  GameCatalogT,
  GameCatalogEntryT,
  GameBackupT,
  GameFileEntryT,
  GameServerStatusT,
  GameServerTabT,
  ProjectRoleT,
  GameFormValuesT,
  GamePortInputsT,
  GameServerPermissionsI,
  GameServerFormPropsI,
  GameVariableFieldPropsI,
  GamePortsFieldsPropsI,
  MemoryFieldPropsI,
  NewGameServerModalPropsI,
  GameCatalogPickerPropsI,
  GeneratedSecretsViewPropsI,
  GameServerTabPropsI,
  GameServerCardItemI,
  GameModsListT,
  GameModT,
  ModSourceInfoT,
  ModSearchHitT,
  ModSourceIdT,
  ModpackChoiceI,
  AddModsModalPropsI,
  ModRowPropsI,
  ModpackCardPropsI,
  ModpackPickerPropsI,
};
