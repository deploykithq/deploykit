import { useState } from "react";

import { useAuthStore } from "@lib/auth";
import { trpc } from "@lib/trpc";

import type { ProjectI } from "@project/infrastructure/ui/interfaces/project.interfaces";

export const useStatusPageSection = (project: ProjectI) => {
  const canWrite = useAuthStore((s) => s.canWrite)();
  const utils = trpc.useUtils();

  const [enabled, setEnabled] = useState(!!project.statusPageEnabled);
  const [slug, setSlug] = useState(project.statusPageSlug ?? "");
  const [title, setTitle] = useState(project.statusPageTitle ?? "");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => utils.project.byId.invalidate({ id: project.id });

  const updateStatusPage = trpc.project.updateStatusPage.useMutation({
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const updateApp = trpc.application.update.useMutation({
    onSuccess: invalidate,
  });

  const save = () =>
    updateStatusPage.mutate({
      id: project.id,
      enabled,
      slug: slug.trim() || undefined,
      title: title.trim() || undefined,
    });

  const publicUrl =
    project.statusPageEnabled && project.statusPageSlug
      ? `${window.location.origin}/status/${project.statusPageSlug}`
      : null;

  return {
    canWrite,
    enabled,
    setEnabled,
    slug,
    setSlug,
    title,
    setTitle,
    error,
    updateStatusPage,
    updateApp,
    save,
    publicUrl,
  };
};
