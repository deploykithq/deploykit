import { useEffect, useState } from "react";

import { trpc } from "@lib/trpc";

import { CHANNEL_TYPES } from "@project/infrastructure/ui/constants/project.constants";

import type {
  ChannelTypeT,
  EditableChannelI,
} from "@project/infrastructure/ui/interfaces/project.interfaces";

export const useNotificationChannelForm = (
  projectId: string,
  open: boolean,
  onClose: () => void,
  editChannel?: EditableChannelI | null,
) => {
  const isEditing = !!editChannel;
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelTypeT>("discord");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    "deploy.success",
    "deploy.failed",
  ]);

  // Rellena el formulario al editar; lo resetea al crear.
  useEffect(() => {
    if (editChannel) {
      setName(editChannel.name);
      setType(editChannel.type as ChannelTypeT);
      setConfig(editChannel.config);
      setSelectedEvents(editChannel.events);
    } else {
      setName("");
      setType("discord");
      setConfig({});
      setSelectedEvents(["deploy.success", "deploy.failed"]);
    }
  }, [editChannel, open]);

  const createMutation = trpc.notification.create.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate({ projectId });
      onClose();
    },
  });

  const updateMutation = trpc.notification.update.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate({ projectId });
      onClose();
    },
  });

  const testMutation = trpc.notification.test.useMutation();

  const handleConfigChange = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  // Cambiar de tipo invalida la configuración anterior: cada canal tiene campos distintos.
  const selectChannelType = (next: ChannelTypeT) => {
    setType(next);
    setConfig({});
  };

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  const handleSubmit = () => {
    if (!name.trim() || selectedEvents.length === 0) return;

    if (isEditing) {
      updateMutation.mutate({
        id: editChannel!.id,
        name: name.trim(),
        config,
        events: selectedEvents as any,
      });
    } else {
      createMutation.mutate({
        projectId,
        name: name.trim(),
        type,
        config,
        events: selectedEvents as any,
        enabled: true,
      });
    }
  };

  const handleTest = () => {
    testMutation.mutate({ type, config });
  };

  return {
    isEditing,
    name,
    setName,
    type,
    setType,
    config,
    selectedEvents,
    channelConfig: CHANNEL_TYPES[type],
    isPending: createMutation.isPending || updateMutation.isPending,
    error: createMutation.error || updateMutation.error,
    testMutation,
    selectChannelType,
    handleConfigChange,
    toggleEvent,
    handleSubmit,
    handleTest,
  };
};
