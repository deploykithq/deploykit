import { useState } from "react";

import { useAuthStore } from "@lib/auth";
import { trpc } from "@lib/trpc";

export const useProjectNotifications = (projectId: string) => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editChannel, setEditChannel] = useState<any>(null);

  const canWrite = useAuthStore((s) => s.canWrite)();

  const { data: channels = [], isLoading } = trpc.notification.list.useQuery({
    projectId,
  });

  const handleEdit = (channel: any) => {
    setEditChannel(channel);
    setShowModal(true);
  };

  const handleClose = () => {
    setShowModal(false);
    setEditChannel(null);
  };

  return {
    showModal,
    setShowModal,
    editChannel,
    setEditChannel,
    canWrite,
    channels,
    isLoading,
    handleEdit,
    handleClose,
  };
};
