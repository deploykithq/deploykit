import { useState } from "react";

import { useAuthStore } from "@lib/auth";
import { trpc } from "@lib/trpc";

import { TEST_RESULT_FEEDBACK_MS } from "@project/infrastructure/ui/constants/project.constants";

interface TestResultI {
  success: boolean;
  error?: string;
}

export const useNotificationChannelCard = (projectId: string) => {
  const [showDelete, setShowDelete] = useState(false);
  const [testResult, setTestResult] = useState<TestResultI | null>(null);

  const canWrite = useAuthStore((s) => s.canWrite)();
  const utils = trpc.useUtils();

  const toggleMutation = trpc.notification.toggle.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate({ projectId });
    },
  });

  const deleteMutation = trpc.notification.delete.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate({ projectId });
      setShowDelete(false);
    },
  });

  const testMutation = trpc.notification.test.useMutation({
    onSuccess: (result) => {
      setTestResult(result);
      setTimeout(() => setTestResult(null), TEST_RESULT_FEEDBACK_MS);
    },
  });

  return {
    showDelete,
    setShowDelete,
    testResult,
    canWrite,
    toggleMutation,
    deleteMutation,
    testMutation,
  };
};
