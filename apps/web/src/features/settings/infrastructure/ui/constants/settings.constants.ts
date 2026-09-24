const APP_INFO = [
  { label: "Version", value: "0.3.1" }, // x-release-please-version
  { label: "Build", value: "Nixpacks + Docker" },
  { label: "Reverse Proxy", value: "Traefik v3" },
  { label: "SSL", value: "Let's Encrypt (auto)" },
];

/**
 * Friendly client-side cap before uploading a manifest. It mirrors
 * MANIFEST_MAX_LENGTH in @deploykit/shared, which the API enforces; it is
 * repeated as a plain number so this chunk does not have to pull in zod for
 * one constant.
 */
const MANIFEST_SIZE_LIMIT = 2_000_000;

export { APP_INFO, MANIFEST_SIZE_LIMIT };
