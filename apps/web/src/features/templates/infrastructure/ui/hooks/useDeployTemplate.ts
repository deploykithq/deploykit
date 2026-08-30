import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { trpc } from "@lib/trpc";

import type {
  CatalogEntryT,
  DeployResultI,
} from "@templates/infrastructure/ui/interfaces/templates.interfaces";

interface UseDeployTemplateParamsI {
  template: CatalogEntryT | null;
  open: boolean;
  onClose: () => void;
  projectId?: string;
}

export const useDeployTemplate = ({
  template,
  open,
  onClose,
  projectId,
}: UseDeployTemplateParamsI) => {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [name, setName] = useState<string>("");
  const [domain, setDomain] = useState<string>("");
  const [selectedProject, setSelectedProject] = useState<string>(
    projectId ?? "",
  );
  const [serverId, setServerId] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResultI | null>(null);

  const projectsQuery = trpc.project.list.useQuery(undefined, {
    enabled: open && !projectId,
  });

  const deployMutation = trpc.compose.deployFromTemplate.useMutation({
    onSuccess: (data) => {
      utils.dashboard.summary.invalidate();
      utils.project.list.invalidate();
      utils.project.byId.invalidate({ id: data.projectId });
      utils.compose.list.invalidate();
      setResult(data);
    },
  });

  const effectiveProjectId = projectId ?? selectedProject;

  const close = () => {
    setName("");
    setDomain("");
    setResult(null);
    setServerId(null);
    if (!projectId) setSelectedProject("");
    deployMutation.reset();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!template || !effectiveProjectId) return;
    deployMutation.mutate({
      templateId: template.id,
      projectId: effectiveProjectId,
      name: name.trim(),
      serverId: serverId ?? undefined,
      domain: domain.trim() || undefined,
    });
  };

  const projectOptions = [
    { value: "", label: "Select a project…" },
    ...(projectsQuery.data ?? []).map((p) => ({ value: p.id, label: p.name })),
  ];

  const noProjects =
    !projectId && projectsQuery.isSuccess && projectOptions.length === 1;

  const goToStack = (pid: string, composeServiceId: string) => {
    close();
    navigate({
      to: "/projects/$projectId/compose/$composeId",
      params: { projectId: pid, composeId: composeServiceId },
    });
  };

  return {
    name,
    setName,
    domain,
    setDomain,
    selectedProject,
    setSelectedProject,
    serverId,
    setServerId,
    result,
    effectiveProjectId,
    projectOptions,
    noProjects,
    deploying: deployMutation.isPending,
    error: deployMutation.error?.message ?? null,
    close,
    handleSubmit,
    goToStack,
  };
};
