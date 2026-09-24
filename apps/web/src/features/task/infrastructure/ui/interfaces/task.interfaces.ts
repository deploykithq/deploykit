import type { TaskTargetI } from "@deploykit/shared";

interface TasksTabPropsI {
  target: TaskTargetI;
  /** Compose services to choose from; only passed for a stack target. */
  services?: string[];
}

interface TaskFormValuesI {
  name: string;
  command: string;
  cron: string;
  timezone: string;
  timeoutSeconds: number;
  enabled: boolean;
  /** Only used for a stack target: the Compose service to run in. */
  serviceName: string;
}

/**
 * What the form hands back. `cron` widens to null — an intersection with
 * TaskFormValuesI would keep it `string`, since an intersection narrows.
 */
type TaskSubmitValuesT = Omit<TaskFormValuesI, "cron"> & {
  cron: string | null;
};

export type { TasksTabPropsI, TaskFormValuesI, TaskSubmitValuesT };
