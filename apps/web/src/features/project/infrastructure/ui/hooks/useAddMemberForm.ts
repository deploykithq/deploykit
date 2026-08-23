import { useState } from "react";

import { trpc } from "@lib/trpc";

export const useAddMemberForm = (
  projectId: string,
  open: boolean,
  onClose: () => void,
) => {
  const utils = trpc.useUtils();

  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("viewer");

  const { data: availableUsers = [], isLoading } =
    trpc.projectMember.availableUsers.useQuery({ projectId }, { enabled: open });

  const addMutation = trpc.projectMember.add.useMutation({
    onSuccess: () => {
      utils.projectMember.list.invalidate({ projectId });
      utils.projectMember.availableUsers.invalidate({ projectId });
      setSelectedUserId("");
      setSelectedRole("viewer");
      onClose();
    },
  });

  const handleSubmit = () => {
    if (!selectedUserId) return;
    addMutation.mutate({
      projectId,
      userId: selectedUserId,
      role: selectedRole as any,
    });
  };

  return {
    selectedUserId,
    setSelectedUserId,
    selectedRole,
    setSelectedRole,
    availableUsers,
    isLoading,
    adding: addMutation.isPending,
    addError: addMutation.error,
    handleSubmit,
  };
};
