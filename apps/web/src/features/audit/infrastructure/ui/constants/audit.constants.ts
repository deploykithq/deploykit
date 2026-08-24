const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Logged in",
  "auth.register": "Registered",
  "auth.change_password": "Changed password",
  "auth.update_profile": "Updated profile",
  "project.create": "Created project",
  "project.update": "Updated project",
  "project.delete": "Deleted project",
  "application.create": "Created application",
  "application.update": "Updated application",
  "application.delete": "Deleted application",
  "application.deploy": "Deployed application",
  "application.stop": "Stopped application",
  "application.restart": "Restarted application",
  "application.update_env": "Updated env vars",
  "application.add_domain": "Added domain",
  "application.remove_domain": "Removed domain",
  "database.create": "Created database",
  "database.delete": "Deleted database",
  "database.stop": "Stopped database",
  "database.restart": "Restarted database",
  "database.backup": "Triggered backup",
  "database.update_backup_config": "Updated backup config",
  "server.create": "Added server",
  "server.update": "Updated server",
  "server.delete": "Deleted server",
  "user.create": "Created user",
  "user.update_role": "Changed user role",
  "user.reset_password": "Reset user password",
  "user.delete": "Deleted user",
  "session.revoke": "Revoked session",
};

const RESOURCE_COLORS: Record<string, string> = {
  application: "bg-accent-muted text-accent-hover",
  database:
    "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
  project:
    "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400",
  server: "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400",
  user: "bg-pink-50 text-pink-700 dark:bg-pink-900/20 dark:text-pink-400",
  session: "bg-surface-2 text-text-secondary",
};

const ACTION_COLORS: Record<string, string> = {
  delete: "text-danger",
  stop: "text-warning",
  deploy: "text-success",
  create: "text-accent",
  reset_password: "text-warning",
  revoke: "text-warning",
};

export { ACTION_LABELS, RESOURCE_COLORS, ACTION_COLORS };
