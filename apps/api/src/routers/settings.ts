import { TRPCError } from "@trpc/server";

import { GAME_MOD_KEYS, setGameModKeySchema } from "@deploykit/shared";

import { router, adminProcedure } from "../trpc";
import { logAction } from "../lib/audit/audit";
import { setSetting, settingStatus } from "../services/instance-settings";
import { validateModKey, ModSourceError } from "../services/mod-sources/index";

/**
 * Instance settings. Admin only; a stored value is never returned — only
 * whether it is set and its last four characters.
 */
export const settingsRouter = router({
  modKeys: router({
    status: adminProcedure.query(async () =>
      Object.fromEntries(
        await Promise.all(GAME_MOD_KEYS.map(async (k) => [k, await settingStatus(k)] as const)),
      ),
    ),

    set: adminProcedure.input(setGameModKeySchema).mutation(async ({ ctx, input }) => {
      if (input.value !== null) {
        try {
          await validateModKey(input.key, input.value);
        } catch (err) {
          if (err instanceof ModSourceError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                err.code === "UNAUTHORIZED" ? "The provider rejected this key" : err.message,
            });
          }
          throw err;
        }
      }
      await setSetting(input.key, input.value, ctx.user.id);
      await logAction(ctx, {
        action: "settings.update",
        resourceType: "settings",
        resourceName: input.key,
        metadata: { cleared: input.value === null },
      });
      return settingStatus(input.key);
    }),
  }),
});
