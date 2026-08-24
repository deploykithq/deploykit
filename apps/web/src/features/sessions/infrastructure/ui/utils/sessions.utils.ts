const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Chrome\//, "Chrome"],
  [/Firefox\//, "Firefox"],
  [/Safari\//, "Safari"],
  [/curl\//, "curl"],
  [/PostmanRuntime/, "Postman"],
];

const PLATFORMS: [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/Android/, "Android"],
  [/iPhone|iPad|iOS/, "iOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

const matchFirst = (userAgent: string, table: [RegExp, string][]) =>
  table.find(([re]) => re.test(userAgent))?.[1];

/**
 * Traduce un user-agent crudo a algo legible ("Chrome · Windows"). El orden de
 * BROWSERS importa: Edge y Opera también anuncian "Chrome", y Chrome anuncia
 * "Safari".
 */
const formatUserAgent = (userAgent: string | null): string => {
  if (!userAgent) return "Unknown device";

  const browser = matchFirst(userAgent, BROWSERS);
  const platform = matchFirst(userAgent, PLATFORMS);

  if (browser && platform) return `${browser} · ${platform}`;
  return browser ?? platform ?? "Unknown device";
};

const formatDate = (value: string | Date): string =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const timeAgo = (value: string | Date): string => {
  const diff = Date.now() - new Date(value).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

/** Cuánto le queda a una sesión activa; las ya caducadas devuelven "expired". */
const timeUntil = (value: string | Date): string => {
  const diff = new Date(value).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
};

export { formatUserAgent, formatDate, timeAgo, timeUntil };
