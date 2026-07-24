/**
 * Helpers to map container paths declared by an image (`VOLUME` directive) to
 * deterministic named Docker volumes. Without a covering bind, the daemon
 * creates a fresh anonymous volume for each declared path on every container
 * recreation, so the data appears erased after each deploy (it is actually
 * stranded in the orphaned anonymous volume).
 */

/** Slug for a container path, stable per path (also used by template provisioning). */
const volumePathSlug = (containerPath: string): string =>
  containerPath.replace(/^\/+/, "").replace(/[^a-zA-Z0-9_.-]+/g, "-") || "data";

/** Strip trailing slashes so "/data/" and "/data" compare equal. */
const normalizePath = (p: string): string =>
  p.length > 1 ? p.replace(/\/+$/, "") : p;

/**
 * Given the volume paths an image declares and the volumes already configured
 * for the app, return the extra named-volume binds needed to cover the
 * declared paths. Names are deterministic (`dk-<app>-<path-slug>`) so every
 * deploy reattaches the same volume.
 */
const autoMapImageVolumes = (
  appName: string,
  declaredPaths: string[],
  configuredVolumes: string[],
): string[] => {
  const covered = new Set(
    configuredVolumes
      .map((v) => v.split(":")[1])
      .filter((p): p is string => !!p)
      .map(normalizePath),
  );

  const added: string[] = [];
  for (const declared of declaredPaths) {
    const target = normalizePath(declared);
    if (!target.startsWith("/") || covered.has(target)) continue;
    covered.add(target);
    added.push(`dk-${appName}-${volumePathSlug(target)}:${target}`);
  }
  return added;
};

export { volumePathSlug, autoMapImageVolumes };
