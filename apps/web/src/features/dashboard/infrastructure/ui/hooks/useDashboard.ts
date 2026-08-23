import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useServiceUpdates } from "@lib/socket";
import { trpc } from "@lib/trpc";

import { DASHBOARD_REFETCH_MS } from "@dashboard/infrastructure/ui/constants/dashboard.constants";

export const useDashboard = () => {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  useServiceUpdates();

  const { data, isLoading } = trpc.dashboard.summary.useQuery(undefined, {
    refetchInterval: DASHBOARD_REFETCH_MS,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const createMutation = trpc.project.create.useMutation({
    onSuccess: (project) => {
      utils.dashboard.summary.invalidate();
      utils.project.list.invalidate();
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      navigate({
        to: "/projects/$projectId",
        params: { projectId: project.id },
      });
    },
  });

  const handleCreateProject = () => {
    if (!newName.trim()) return;
    createMutation.mutate({
      name: newName.trim(),
      description: newDesc.trim() || undefined,
    });
  };

  return {
    data,
    isLoading,
    navigate,
    showCreate,
    setShowCreate,
    newName,
    setNewName,
    newDesc,
    setNewDesc,
    creating: createMutation.isPending,
    handleCreateProject,
  };
};
