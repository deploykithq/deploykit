import { trpc } from "@lib/trpc";

import type { DatabaseI } from "@database/infrastructure/ui/interfaces/database.interfaces";

export const useDatabaseDetail = (databaseId: string) => {
  const { data: rawDb, isLoading } = trpc.database.byId.useQuery({
    id: databaseId,
  });

  // Cast en la frontera de tRPC: el servidor devuelve `type` como string plano,
  // pero siempre será uno de nuestros DatabaseType.
  const db = rawDb as DatabaseI | undefined;

  return { db, isLoading };
};
