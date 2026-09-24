/**
 * Strip encrypted secret columns from rows before they reach a client.
 *
 * The ciphertext is useless without ENCRYPTION_KEY, but it is still secret
 * material and there is no reason for it to cross the wire. `application.byId`
 * has always stripped it by hand; these helpers exist so every other query that
 * returns whole rows (project listings, preview listings, the row a mutation
 * echoes back) does the same thing the same way.
 *
 * Each helper reports the presence of what it removed, matching the
 * `hasSourceToken` / `hasWebhookSecret` flags the UI already reads.
 */

type WithAppSecrets = {
  sourceToken?: string | null;
  webhookSecret?: string | null;
};

type WithDbSecrets = {
  dbPassword?: string | null;
};

/** Drop an application's encrypted columns, keeping "is it set?" visible. */
const toPublicApplication = <T extends WithAppSecrets>(app: T) => {
  const { sourceToken, webhookSecret, ...rest } = app;
  return {
    ...rest,
    hasSourceToken: !!sourceToken,
    hasWebhookSecret: !!webhookSecret,
  };
};

/** Drop a database's encrypted password, keeping "is it set?" visible. */
const toPublicDatabase = <T extends WithDbSecrets>(database: T) => {
  const { dbPassword, ...rest } = database;
  return { ...rest, hasPassword: !!dbPassword };
};

/** Apply `toPublicApplication`/`toPublicDatabase` to a project's children. */
const toPublicProject = <
  T extends {
    applications?: WithAppSecrets[];
    databases?: WithDbSecrets[];
  },
>(
  project: T,
) => ({
  ...project,
  ...(project.applications && {
    applications: project.applications.map(toPublicApplication),
  }),
  ...(project.databases && {
    databases: project.databases.map(toPublicDatabase),
  }),
});

export { toPublicApplication, toPublicDatabase, toPublicProject };
