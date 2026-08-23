import { useRef, useState } from "react";

import { trpc } from "@lib/trpc";

import { INSTANCES_REFETCH_MS } from "@application/infrastructure/ui/constants/application.constants";

/**
 * Estado y guardado de la pestaña General de una aplicación.
 * El guardado envía SOLO los campos que el usuario tocó (ver `initial`).
 */
export const useGeneralTab = (app: any, applicationId: string) => {
  const utils = trpc.useUtils();
  const updateMutation = trpc.application.update.useMutation({
    onSuccess: () => utils.application.byId.invalidate({ id: applicationId }),
  });

  const [repoUrl, setRepoUrl] = useState(app.repositoryUrl || "");
  const [branch, setBranch] = useState(app.branch || "main");
  const [sourceToken, setSourceToken] = useState("");
  const [tokenDirty, setTokenDirty] = useState(false);
  const [rootDirectory, setRootDirectory] = useState(app.rootDirectory || "");
  const [volumes, setVolumes] = useState<string[]>(
    (app.volumes as string[]) || [],
  );
  const [newVolume, setNewVolume] = useState("");
  const [buildType, setBuildType] = useState(app.buildType || "nixpacks");
  const [dockerfilePath, setDockerfilePath] = useState(
    app.dockerfilePath || "Dockerfile",
  );
  const [startCommand, setStartCommand] = useState(app.startCommand || "");
  const [port, setPort] = useState(String(app.port || ""));

  // Resources
  const [cpuCores, setCpuCores] = useState(
    app.cpuLimit ? String(app.cpuLimit / 1000) : "",
  );
  const [memoryMb, setMemoryMb] = useState(
    app.memoryLimit ? String(app.memoryLimit) : "",
  );
  const [replicas, setReplicas] = useState(String(app.replicas ?? 1));
  const hasDomain = (app.domains?.length ?? 0) > 0;

  // Autoscaling
  const [autoscaleEnabled, setAutoscaleEnabled] = useState(
    app.autoscaleEnabled ?? false,
  );
  const [autoscaleMin, setAutoscaleMin] = useState(
    String(app.autoscaleMin ?? 1),
  );
  const [autoscaleMax, setAutoscaleMax] = useState(
    String(app.autoscaleMax ?? 3),
  );
  const [autoscaleCpuTarget, setAutoscaleCpuTarget] = useState(
    app.autoscaleCpuTarget != null ? String(app.autoscaleCpuTarget) : "70",
  );
  const [autoscaleMemTarget, setAutoscaleMemTarget] = useState(
    app.autoscaleMemTarget != null ? String(app.autoscaleMemTarget) : "",
  );

  // Live instance status (replicas). Polled while the tab is open.
  const instancesQuery = trpc.application.instances.useQuery(
    { id: applicationId },
    { refetchInterval: INSTANCES_REFETCH_MS },
  );

  // Health check
  const [hcType, setHcType] = useState(app.healthCheckType ?? "http");
  const [hcPath, setHcPath] = useState(app.healthCheckPath ?? "/");
  const [hcTimeout, setHcTimeout] = useState(
    String(app.healthCheckTimeout ?? 5),
  );
  const [hcInterval, setHcInterval] = useState(
    String(app.healthCheckInterval ?? 10),
  );
  const [hcRetries, setHcRetries] = useState(
    String(app.healthCheckRetries ?? 6),
  );
  const [hcRequired, setHcRequired] = useState(
    app.healthCheckRequired ?? false,
  );

  // Preview deployments
  const [previewEnabled, setPreviewEnabled] = useState(
    app.previewEnabled ?? false,
  );
  const [previewDomain, setPreviewDomain] = useState(app.previewDomain ?? "");

  // Security scanning (tri-state: inherit global default / on / off)
  const [scanMode, setScanMode] = useState<"default" | "on" | "off">(
    app.scanEnabled == null ? "default" : app.scanEnabled ? "on" : "off",
  );

  // Snapshot of the values this form opened with. Save sends ONLY fields the
  // user actually changed: sending the whole form would turn every save into
  // a stale read-modify-write that reverts (or wipes — volumes:null) config
  // modified elsewhere while this tab sat on a cached snapshot.
  const initial = useRef({
    repoUrl: app.repositoryUrl || "",
    branch: app.branch || "main",
    rootDirectory: app.rootDirectory || "",
    volumes: JSON.stringify((app.volumes as string[]) || []),
    buildType: app.buildType || "nixpacks",
    dockerfilePath: app.dockerfilePath || "Dockerfile",
    startCommand: app.startCommand || "",
    port: String(app.port || ""),
    cpuCores: app.cpuLimit ? String(app.cpuLimit / 1000) : "",
    memoryMb: app.memoryLimit ? String(app.memoryLimit) : "",
    replicas: String(app.replicas ?? 1),
    autoscaleEnabled: app.autoscaleEnabled ?? false,
    autoscaleMin: String(app.autoscaleMin ?? 1),
    autoscaleMax: String(app.autoscaleMax ?? 3),
    autoscaleCpuTarget:
      app.autoscaleCpuTarget != null ? String(app.autoscaleCpuTarget) : "70",
    autoscaleMemTarget:
      app.autoscaleMemTarget != null ? String(app.autoscaleMemTarget) : "",
    hcType: app.healthCheckType ?? "http",
    hcPath: app.healthCheckPath ?? "/",
    hcTimeout: String(app.healthCheckTimeout ?? 5),
    hcInterval: String(app.healthCheckInterval ?? 10),
    hcRetries: String(app.healthCheckRetries ?? 6),
    hcRequired: app.healthCheckRequired ?? false,
    previewEnabled: app.previewEnabled ?? false,
    previewDomain: app.previewDomain ?? "",
    scanMode: (app.scanEnabled == null
      ? "default"
      : app.scanEnabled
        ? "on"
        : "off") as "default" | "on" | "off",
  }).current;

  const handleSave = () =>
    updateMutation.mutate({
      id: applicationId,
      ...(repoUrl !== initial.repoUrl && {
        repositoryUrl: repoUrl || undefined,
      }),
      ...(branch !== initial.branch && { branch }),
      ...(buildType !== initial.buildType && { buildType }),
      ...(buildType === "dockerfile" &&
        (dockerfilePath !== initial.dockerfilePath ||
          buildType !== initial.buildType) && {
          dockerfilePath: dockerfilePath || "Dockerfile",
        }),
      ...(startCommand !== initial.startCommand && {
        startCommand: startCommand || null,
      }),
      ...(port !== initial.port && { port: parseInt(port) || undefined }),
      ...(tokenDirty && { sourceToken: sourceToken || null }),
      ...(rootDirectory !== initial.rootDirectory && {
        rootDirectory: rootDirectory || null,
      }),
      ...(JSON.stringify(volumes) !== initial.volumes && {
        volumes: volumes.length > 0 ? volumes : null,
      }),
      // Resources: cores → millicores; empty = unlimited (null)
      ...(cpuCores !== initial.cpuCores && {
        cpuLimit: cpuCores.trim()
          ? Math.round(parseFloat(cpuCores) * 1000)
          : null,
      }),
      ...(memoryMb !== initial.memoryMb && {
        memoryLimit: memoryMb.trim() ? parseInt(memoryMb) : null,
      }),
      ...(replicas !== initial.replicas && {
        replicas: parseInt(replicas) || 1,
      }),
      // Autoscaling
      ...(autoscaleEnabled !== initial.autoscaleEnabled && {
        autoscaleEnabled,
      }),
      ...(autoscaleMin !== initial.autoscaleMin && {
        autoscaleMin: parseInt(autoscaleMin) || 1,
      }),
      ...(autoscaleMax !== initial.autoscaleMax && {
        autoscaleMax: parseInt(autoscaleMax) || 3,
      }),
      ...(autoscaleCpuTarget !== initial.autoscaleCpuTarget && {
        autoscaleCpuTarget: autoscaleCpuTarget.trim()
          ? parseInt(autoscaleCpuTarget)
          : null,
      }),
      ...(autoscaleMemTarget !== initial.autoscaleMemTarget && {
        autoscaleMemTarget: autoscaleMemTarget.trim()
          ? parseInt(autoscaleMemTarget)
          : null,
      }),
      ...(hcType !== initial.hcType && { healthCheckType: hcType as any }),
      ...(hcPath !== initial.hcPath && { healthCheckPath: hcPath || "/" }),
      ...(hcTimeout !== initial.hcTimeout && {
        healthCheckTimeout: parseInt(hcTimeout) || 5,
      }),
      ...(hcInterval !== initial.hcInterval && {
        healthCheckInterval: parseInt(hcInterval) || 10,
      }),
      ...(hcRetries !== initial.hcRetries && {
        healthCheckRetries: parseInt(hcRetries) || 6,
      }),
      ...(hcRequired !== initial.hcRequired && {
        healthCheckRequired: hcRequired,
      }),
      ...(previewEnabled !== initial.previewEnabled && { previewEnabled }),
      ...(previewDomain !== initial.previewDomain && {
        previewDomain: previewDomain || null,
      }),
      ...(scanMode !== initial.scanMode && {
        scanEnabled: scanMode === "default" ? null : scanMode === "on",
      }),
    });

  return {
    repoUrl,
    setRepoUrl,
    branch,
    setBranch,
    sourceToken,
    setSourceToken,
    tokenDirty,
    setTokenDirty,
    rootDirectory,
    setRootDirectory,
    volumes,
    setVolumes,
    newVolume,
    setNewVolume,
    buildType,
    setBuildType,
    dockerfilePath,
    setDockerfilePath,
    startCommand,
    setStartCommand,
    port,
    setPort,
    cpuCores,
    setCpuCores,
    memoryMb,
    setMemoryMb,
    replicas,
    setReplicas,
    hasDomain,
    autoscaleEnabled,
    setAutoscaleEnabled,
    autoscaleMin,
    setAutoscaleMin,
    autoscaleMax,
    setAutoscaleMax,
    autoscaleCpuTarget,
    setAutoscaleCpuTarget,
    autoscaleMemTarget,
    setAutoscaleMemTarget,
    instances: instancesQuery.data,
    hcType,
    setHcType,
    hcPath,
    setHcPath,
    hcTimeout,
    setHcTimeout,
    hcInterval,
    setHcInterval,
    hcRetries,
    setHcRetries,
    hcRequired,
    setHcRequired,
    previewEnabled,
    setPreviewEnabled,
    previewDomain,
    setPreviewDomain,
    scanMode,
    setScanMode,
    saving: updateMutation.isPending,
    saveFailed: updateMutation.isError,
    saveError: updateMutation.error,
    handleSave,
  };
};
