import { trpc } from "@lib/trpc";

import { PREVIEWS_REFETCH_MS } from "@application/infrastructure/ui/constants/application.constants";

export const usePreviewsTab = (applicationId: string) => {
  const utils = trpc.useUtils();

  const { data: previews, isLoading } = trpc.application.listPreviews.useQuery(
    { parentId: applicationId },
    { refetchInterval: PREVIEWS_REFETCH_MS },
  );

  const deleteMutation = trpc.application.deletePreview.useMutation({
    onSuccess: () =>
      utils.application.listPreviews.invalidate({ parentId: applicationId }),
  });

  return {
    previews,
    isLoading,
    deleting: deleteMutation.isPending,
    deletePreview: deleteMutation.mutate,
  };
};
