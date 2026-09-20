type AuditActionT =
  // Auth
  | "auth.login"
  | "auth.logout"
  | "auth.register"
  | "auth.change_password"
  | "auth.update_profile"
  // Projects
  | "project.create"
  | "project.update"
  | "project.update_status_page"
  | "project.delete"
  // Applications
  | "application.create"
  | "application.update"
  | "application.delete"
  | "application.deploy"
  | "application.stop"
  | "application.restart"
  | "application.update_env"
  | "application.add_domain"
  | "application.remove_domain"
  // Databases
  | "database.create"
  | "database.delete"
  | "database.stop"
  | "database.restart"
  | "database.backup"
  | "database.restore"
  | "database.update_backup_config"
  // Compose stacks
  | "compose.create"
  | "compose.update"
  | "compose.delete"
  | "compose.deploy"
  | "compose.stop"
  | "compose.start"
  | "compose.restart"
  | "compose.update_env"
  | "compose.add_domain"
  | "compose.remove_domain"
  // Servers
  | "server.create"
  | "server.update"
  | "server.delete"
  // SSH keys
  | "ssh_key.create"
  | "ssh_key.update"
  | "ssh_key.delete"
  // Users (admin actions)
  | "user.create"
  | "user.update_role"
  | "user.reset_password"
  | "user.delete"
  // Notifications
  | "notification.create"
  | "notification.update"
  | "notification.delete"
  // Project members
  | "project_member.add"
  | "project_member.update"
  | "project_member.remove";

type ResourceTypeT =
  | "project"
  | "application"
  | "database"
  | "compose"
  | "server"
  | "ssh_key"
  | "user"
  | "notification_channel";

export type { AuditActionT, ResourceTypeT };
