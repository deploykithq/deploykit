import { useState } from "react";

import { trpc } from "@lib/trpc";

import type {
  AlertServiceI,
  CreateRuleFormI,
} from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

export const useCreateRuleForm = (onCreated: () => void, onClose: () => void) => {
  const utils = trpc.useUtils();

  const [form, setForm] = useState<CreateRuleFormI>({
    serviceType: "application",
    serviceId: "",
    metric: "cpu",
    operator: "gt",
    threshold: 85,
    channel: "ui",
    channelUrl: "",
    cooldown: 15,
  });

  // La lista de servicios se compone a partir de los proyectos existentes.
  const { data: projects } = trpc.project.list.useQuery();

  const allServices: AlertServiceI[] = (projects ?? []).flatMap((p) => [
    ...(p.applications ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      type: "application" as const,
    })),
    ...(p.databases ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      type: "database" as const,
    })),
  ]);

  const serviceOptions = allServices
    .filter((s) => s.type === form.serviceType)
    .map((s) => ({ value: s.id, label: s.name }));

  const mutation = trpc.metrics.createRule.useMutation({
    onSuccess: () => {
      utils.metrics.listRules.invalidate();
      utils.metrics.alertStats.invalidate();
      onCreated();
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const svc = allServices.find((s) => s.id === form.serviceId);
    mutation.mutate({
      serviceType: form.serviceType,
      serviceId: form.serviceId,
      serviceName: svc?.name,
      metric: form.metric as any,
      operator: form.operator as any,
      threshold: form.threshold,
      channel: form.channel as any,
      channelConfig: form.channelUrl ? { url: form.channelUrl } : undefined,
      cooldownMinutes: form.cooldown,
    });
  };

  return {
    form,
    setForm,
    serviceOptions,
    creating: mutation.isPending,
    error: mutation.error,
    handleSubmit,
  };
};
