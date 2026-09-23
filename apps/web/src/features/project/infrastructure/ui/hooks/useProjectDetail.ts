import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { projectDetailRoute } from "@/router";

import { useAuthStore } from "@lib/auth";
import { trpc } from "@lib/trpc";
import { downloadTextFile } from "@lib/utils";

import type { ProjectI } from "@project/infrastructure/ui/interfaces/project.interfaces";

export const useProjectDetail = () => {
  const { projectId } = projectDetailRoute.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const onBack = () => navigate({ to: "/" });

  const onOpenService = (
    type: "application" | "database" | "compose",
    id: string,
  ) => {
    if (type === "application") {
      navigate({
        to: "/projects/$projectId/apps/$appId",
        params: { projectId, appId: id },
      });
    } else if (type === "compose") {
      navigate({
        to: "/projects/$projectId/compose/$composeId",
        params: { projectId, composeId: id },
      });
    } else {
      navigate({
        to: "/projects/$projectId/db/$dbId",
        params: { projectId, dbId: id },
      });
    }
  };

  const [showNewApp, setShowNewApp] = useState(false);
  const [showNewDb, setShowNewDb] = useState(false);
  const [showNewCompose, setShowNewCompose] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const canWrite = useAuthStore((s) => s.canWrite)();
  const isAdmin = useAuthStore((s) => s.isAdmin)();

  const { data: rawProject, isLoading } = trpc.project.byId.useQuery({
    id: projectId,
  });

  const project = rawProject as ProjectI | undefined;

  // Los stacks no cuelgan de `project.byId` (viven en su propio router), así
  // que se piden aparte y se listan junto a aplicaciones y bases de datos.
  const { data: composeStacks } = trpc.compose.list.useQuery({ projectId });

  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      onBack();
    },
  });

  const handleAppCreated = () => {
    setShowNewApp(false);
    utils.project.byId.invalidate({ id: projectId });
  };

  const handleDbCreated = () => {
    setShowNewDb(false);
    utils.project.byId.invalidate({ id: projectId });
  };

  // El export es una mutación (la respuesta puede llevar secretos y no debe
  // quedarse en la caché de React Query), así que se dispara a mano.
  const exportMutation = trpc.config.exportProject.useMutation();

  const exportProject = async () => {
    if (!project) return;
    try {
      const result = await exportMutation.mutateAsync({
        projectId,
        includeSecrets: false,
      });
      const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      downloadTextFile(
        `deploykit-${slug || "project"}-${new Date().toISOString().slice(0, 10)}.yaml`,
        result.manifest,
        "text/yaml",
      );
    } catch {
      // Rendered from exportError.
    }
  };

  return {
    projectId,
    project,
    isLoading,
    onBack,
    onOpenService,
    canWrite,
    isAdmin,
    showNewApp,
    setShowNewApp,
    showNewDb,
    setShowNewDb,
    showNewCompose,
    setShowNewCompose,
    composeStacks: composeStacks ?? [],
    showDeleteConfirm,
    setShowDeleteConfirm,
    deleting: deleteMutation.isPending,
    deleteProject: () => deleteMutation.mutate({ id: projectId }),
    handleAppCreated,
    handleDbCreated,
    exportProject,
    exporting: exportMutation.isPending,
    exportError: exportMutation.error?.message ?? null,
  };
};
