import { useState } from "react";

import { useAuthStore } from "@lib/auth";
import { trpc } from "@lib/trpc";

export const useProjectMembers = (projectId: string) => {
  const [showModal, setShowModal] = useState(false);

  const globalRole = useAuthStore((s) => s.user?.role);

  const { data: myRole } = trpc.projectMember.myRole.useQuery({ projectId });
  const { data: members = [], isLoading } = trpc.projectMember.list.useQuery({
    projectId,
  });

  const effectiveRole = myRole?.role || globalRole || "viewer";
  const canManage = effectiveRole === "admin";

  return { showModal, setShowModal, members, isLoading, canManage };
};
