import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Template } from "@deploykit/shared";

import { trpc } from "@lib/trpc";

import type { DeployResultI } from "@templates/infrastructure/ui/interfaces/templates.interfaces";

interface UseDeployTemplateParamsI {
  template: Template | null;
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
  const [selectedProject, setSelectedProject] = useState<string>(
    projectId ?? "",
  );
  const [serverId, setServerId] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResultI | null>(null);

  const projectsQuery = trpc.project.list.useQuery(undefined, {
    enabled: open && !projectId,
  });

  const deployMutation = trpc.template.deploy.useMutation({
    onSuccess: (data) => {
      utils.dashboard.summary.invalidate();
      utils.project.list.invalidate();
      utils.project.byId.invalidate({ id: data.projectId });
      setResult(data);
    },
    onError: (err) => alert(err.message),
  });

  const effectiveProjectId = projectId ?? selectedProject;

  const close = () => {
    setName("");
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
    });
  };

  const projectOptions = [
    { value: "", label: "Select a project…" },
    ...(projectsQuery.data ?? []).map((p) => ({
      value: p.id,
      label: p.name,
    })),
  ];

  const noProjects =
    !projectId && projectsQuery.isSuccess && projectOptions.length === 1;

  const goToApp = (pid: string, appId: string) => {
    close();
    navigate({
      to: "/projects/$projectId/apps/$appId",
      params: { projectId: pid, appId },
    });
  };

  const goToProject = (pid: string) => {
    close();
    navigate({ to: "/projects/$projectId", params: { projectId: pid } });
  };

  return {
    name,
    setName,
    selectedProject,
    setSelectedProject,
    serverId,
    setServerId,
    result,
    effectiveProjectId,
    projectOptions,
    noProjects,
    deploying: deployMutation.isPending,
    close,
    handleSubmit,
    goToApp,
    goToProject,
  };
};
