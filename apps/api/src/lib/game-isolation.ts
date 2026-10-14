/**
 * Game servers get a network of their own. Mods and plugins are third-party
 * code, and on deploykit-network they could reach DeployKit's Redis (the job
 * queues the API executes with the Docker socket) and Postgres. Only the API
 * joins this one, for RCON.
 */
const GAME_NETWORK = "deploykit-games";

/**
 * Hardening every game container gets. The catalogue's images (DeployKit's
 * own, deploykithq/deploykit-game-images) start as root and drop to uid 1000
 * with syscalls, which needs SETUID/SETGID/CHOWN — kept; `scripts/smoke-run.sh`
 * there boots every image under exactly these flags. The volume helpers take
 * the same, as Docker HostConfig keys.
 */
const GAME_HARDENING = {
  securityOpt: ["no-new-privileges:true"],
  capDrop: ["NET_RAW", "MKNOD", "AUDIT_WRITE", "SYS_CHROOT", "SETFCAP", "SETPCAP"],
  pidsLimit: 2048,
};

export { GAME_NETWORK, GAME_HARDENING };
