import type { GameSpecT, GameValueT } from "@deploykit/shared";

import { getAccessToken } from "@lib/trpc";

import { SECRET_MASK } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type {
  GameFormValuesT,
  GamePortInputsT,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

// ---------------------------------------------------------------------------
// Form values
// ---------------------------------------------------------------------------

/**
 * Starting values of the variables form.
 *
 * On create every field takes the game's default. On update it takes the
 * server's current value, except secrets, which start blank: blank means
 * "keep the current one" to the API, and the masked placeholder must never be
 * sent back as if it were the new password.
 */
const initialFormValues = (
  spec: Pick<GameSpecT, "variables">,
  mode: "create" | "update",
  current: Record<string, string> = {},
): GameFormValuesT => {
  const values: GameFormValuesT = {};
  for (const v of spec.variables) {
    if (mode === "update") {
      const raw = current[v.key];
      if (v.secret) values[v.key] = "";
      else if (v.type === "boolean") values[v.key] = raw === "true";
      else values[v.key] = raw ?? "";
      continue;
    }
    if (v.type === "boolean") values[v.key] = v.default === true;
    else values[v.key] = v.default === undefined ? "" : String(v.default);
  }
  return values;
};

/**
 * Turn form input into the `values` the API takes.
 *
 * Blank fields are left out on create so the API applies the default or the
 * generator. On update only editable fields are sent, and a blank secret is
 * dropped (kept as it is).
 */
const toPayloadValues = (
  spec: Pick<GameSpecT, "variables">,
  form: GameFormValuesT,
  mode: "create" | "update",
): Record<string, GameValueT> => {
  const out: Record<string, GameValueT> = {};
  for (const v of spec.variables) {
    const raw = form[v.key];
    if (raw === undefined) continue;
    if (mode === "update" && !v.editable) continue;
    if (typeof raw === "boolean") {
      out[v.key] = raw;
      continue;
    }
    if (raw === "") {
      if (mode === "update" && !v.secret && !v.required) out[v.key] = "";
      continue;
    }
    if (mode === "update" && v.secret && raw === SECRET_MASK) continue;
    out[v.key] = v.type === "number" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  return out;
};

/** Variables grouped by their `group`, in declaration order. */
const groupVariables = <T extends { group?: string }>(
  variables: T[],
): Array<{ group: string | null; items: T[] }> => {
  const groups: Array<{ group: string | null; items: T[] }> = [];
  for (const v of variables) {
    const key = v.group ?? null;
    let bucket = groups.find((g) => g.group === key);
    if (!bucket) {
      bucket = { group: key, items: [] };
      groups.push(bucket);
    }
    bucket.items.push(v);
  }
  return groups;
};

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Ports the user picks a host port for: those that follow no other. */
const basePorts = (spec: Pick<GameSpecT, "ports">) =>
  spec.ports.filter((p) => p.offsetOf === undefined);

const initialPortInputs = (
  spec: Pick<GameSpecT, "ports">,
  current?: { name: string; hostPort: number }[],
): GamePortInputsT => {
  const inputs: GamePortInputsT = {};
  for (const p of basePorts(spec)) {
    const existing = current?.find((c) => c.name === p.name);
    inputs[p.name] = String(existing?.hostPort ?? p.defaultHost ?? p.container);
  }
  return inputs;
};

/** The host port an offset port will get, or null while its base is invalid. */
const derivedHostPort = (
  port: GameSpecT["ports"][number],
  inputs: GamePortInputsT,
): number | null => {
  if (port.offsetOf === undefined) return null;
  const base = Number(inputs[port.offsetOf]);
  if (!Number.isInteger(base)) return null;
  const host = base + (port.offset ?? 0);
  return host >= 1 && host <= 65535 ? host : null;
};

/** Parse the port inputs, or return an error per invalid one. */
const parsePortInputs = (
  inputs: GamePortInputsT,
): { ports: Record<string, number>; errors: Record<string, string> } => {
  const ports: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const [name, raw] of Object.entries(inputs)) {
    const n = Number(raw);
    if (!raw.trim() || !Number.isInteger(n) || n < 1 || n > 65535) {
      errors[name] = "Must be a port between 1 and 65535";
    } else {
      ports[name] = n;
    }
  }
  return { ports, errors };
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const joinPath = (dir: string, name: string): string =>
  dir ? `${dir.replace(/\/+$/, "")}/${name}` : name;

const parentPath = (p: string): string => {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
};

const baseName = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

// ---------------------------------------------------------------------------
// Authenticated transfers (outside tRPC: bodies too large for it)
// ---------------------------------------------------------------------------

const errorFromBody = async (res: Response): Promise<string> => {
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // Not JSON.
  }
  return `Request failed (${res.status})`;
};

/** File name from a Content-Disposition header, preferring `filename*`. */
const fileNameFromDisposition = (header: string | null): string | null => {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // Fall through to the plain form.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1] ?? null;
};

/**
 * Download a file the API streams behind a Bearer token. A plain link cannot
 * carry the header, so the body is fetched into a blob and saved from there.
 */
const downloadWithAuth = async (url: string, fallbackName: string): Promise<void> => {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await errorFromBody(res));

  const blob = await res.blob();
  const name =
    fileNameFromDisposition(res.headers.get("Content-Disposition")) ?? fallbackName;
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(href), 0);
};

/**
 * Upload a file as a raw body. XHR rather than fetch because only XHR reports
 * upload progress.
 */
const uploadWithProgress = async (
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> => {
  const token = await getAccessToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        if (typeof body?.error === "string") message = body.error;
      } catch {
        // Not JSON.
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
};

export {
  initialFormValues,
  toPayloadValues,
  groupVariables,
  basePorts,
  initialPortInputs,
  derivedHostPort,
  parsePortInputs,
  joinPath,
  parentPath,
  baseName,
  downloadWithAuth,
  uploadWithProgress,
};
