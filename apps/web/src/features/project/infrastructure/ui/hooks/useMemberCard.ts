import { useState } from "react";

import { trpc } from "@lib/trpc";

export const useMemberCard = (projectId: string) => {
  const utils = trpc.useUtils();

  const [showDelete, setShowDelete] = useState(false);
  const [showRoleMenu, setShowRoleMenu] = useState(false);

  const updateRoleMutation = trpc.projectMember.updateRole.useMutation({
    onSuccess: () => {
      utils.projectMember.list.invalidate({ projectId });
      setShowRoleMenu(false);
    },
  });

  const removeMutation = trpc.projectMember.remove.useMutation({
    onSuccess: () => {
      utils.projectMember.list.invalidate({ projectId });
      utils.projectMember.availableUsers.invalidate({ projectId });
      setShowDelete(false);
    },
  });

  return {
    showDelete,
    setShowDelete,
    showRoleMenu,
    setShowRoleMenu,
    updatingRole: updateRoleMutation.isPending,
    removing: removeMutation.isPending,
    updateRole: updateRoleMutation.mutate,
    removeMember: removeMutation.mutate,
  };
};
