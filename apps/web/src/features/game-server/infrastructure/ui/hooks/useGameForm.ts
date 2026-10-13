import { useCallback, useEffect, useState } from "react";
import { validateGameValues } from "@deploykit/shared";
import type { GameSpecT, GameValueT } from "@deploykit/shared";

import {
  initialFormValues,
  initialPortInputs,
  parsePortInputs,
  toPayloadValues,
} from "@game-server/infrastructure/ui/utils/game-server.utils";

import type {
  GameFormValuesT,
  GamePortInputsT,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

interface UseGameFormParamsI {
  spec: Pick<GameSpecT, "variables" | "ports" | "resources"> | null | undefined;
  mode: "create" | "update";
  /** Update only: the server's current values, ports and memory. */
  currentValues?: Record<string, string>;
  currentPorts?: { name: string; hostPort: number }[];
  currentMemoryMb?: number;
}

interface GameFormPayloadI {
  values: Record<string, GameValueT>;
  ports: Record<string, number>;
  memoryMb: number;
}

/**
 * State of the game settings form — variables, host ports and memory — shared
 * by the create modal and the Settings tab.
 *
 * Validation runs the same `validateGameValues` the API runs, so a form that
 * passes here is not bounced for the same reason by the server.
 */
export const useGameForm = ({
  spec,
  mode,
  currentValues,
  currentPorts,
  currentMemoryMb,
}: UseGameFormParamsI) => {
  const [values, setValues] = useState<GameFormValuesT>({});
  const [ports, setPorts] = useState<GamePortInputsT>({});
  const [memoryMb, setMemoryMb] = useState<number>(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [portErrors, setPortErrors] = useState<Record<string, string>>({});
  const [memoryError, setMemoryError] = useState<string | null>(null);

  const reset = useCallback(() => {
    if (!spec) return;
    setValues(initialFormValues(spec, mode, currentValues));
    setPorts(initialPortInputs(spec, currentPorts));
    setMemoryMb(currentMemoryMb ?? spec.resources.memoryMb.recommended);
    setErrors({});
    setPortErrors({});
    setMemoryError(null);
    // Reset only when the definition or the saved server changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, mode, JSON.stringify(currentValues), JSON.stringify(currentPorts), currentMemoryMb]);

  useEffect(() => {
    reset();
  }, [reset]);

  const setValue = useCallback((key: string, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const setPort = useCallback((name: string, value: string) => {
    setPorts((prev) => ({ ...prev, [name]: value }));
    setPortErrors((prev) => {
      if (!prev[name]) return prev;
      const { [name]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  /** Validate everything; returns the API payload, or null and shows errors. */
  const buildPayload = (): GameFormPayloadI | null => {
    if (!spec) return null;
    const payloadValues = toPayloadValues(spec, values, mode);
    const result = validateGameValues(spec, payloadValues, mode, currentValues);
    const parsedPorts = parsePortInputs(ports);

    const memoryFloor = Math.max(spec.resources.memoryMb.min, 256);
    const memoryProblem =
      !Number.isInteger(memoryMb) || memoryMb < memoryFloor || memoryMb > 65536
        ? `Memory must be between ${memoryFloor} and 65536 MB`
        : null;

    setErrors(result.errors);
    setPortErrors(parsedPorts.errors);
    setMemoryError(memoryProblem);

    if (
      Object.keys(result.errors).length > 0 ||
      Object.keys(parsedPorts.errors).length > 0 ||
      memoryProblem
    ) {
      return null;
    }
    return { values: payloadValues, ports: parsedPorts.ports, memoryMb };
  };

  /** Whether the host ports differ from the saved ones (update only). */
  const portsChanged = (): boolean =>
    !!currentPorts &&
    Object.entries(ports).some(
      ([name, raw]) =>
        currentPorts.find((p) => p.name === name)?.hostPort !== Number(raw),
    );

  return {
    values,
    setValue,
    ports,
    setPort,
    memoryMb,
    setMemoryMb,
    memoryError,
    errors,
    portErrors,
    buildPayload,
    portsChanged,
    reset,
  };
};
