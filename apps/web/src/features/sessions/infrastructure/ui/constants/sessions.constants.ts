import type {
  SessionStatusT,
  SessionStatusFilterT,
} from "@sessions/infrastructure/ui/interfaces/sessions.interfaces";

/** Las tres opciones del select de estado. */
const STATUS_OPTIONS: { value: SessionStatusFilterT; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
];

/**
 * El filtro solo distingue activa/expirada, pero el badge de la fila sí separa
 * una sesión revocada de una caducada por tiempo.
 */
const STATUS_STYLES: Record<SessionStatusT, string> = {
  active: "bg-success/10 text-success",
  expired: "bg-surface-2 text-text-muted",
  revoked: "bg-danger/10 text-danger",
};

const STATUS_LABELS: Record<SessionStatusT, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

export { STATUS_OPTIONS, STATUS_STYLES, STATUS_LABELS };
