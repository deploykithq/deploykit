import { memo } from "react";

import { Card } from "@shared/components/card";
import {
  UserAvatar,
  RoleSelector,
  UserActions,
} from "@users/infrastructure/ui/components";

import { timeAgo } from "@lib/utils";

interface UserCardPropsI {
  user: {
    id: string;
    email: string;
    role: string;
    createdAt: string;
    updatedAt: string;
  };
  isSelf: boolean;
  onDelete: () => void;
  onResetPassword: () => void;
}

export const UserCard: React.FC<UserCardPropsI> = memo(function UserCard({
  user,
  isSelf,
  onDelete,
  onResetPassword,
}) {
  return (
    <Card>
      <div className="flex items-center gap-4">
        <UserAvatar email={user.email} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{user.email}</span>
            {isSelf && (
              <span className="text-[10px] uppercase tracking-wider font-medium text-accent bg-accent-muted px-1.5 py-0.5 rounded">
                You
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
            <span>Created {timeAgo(user.createdAt)}</span>
            {user.updatedAt !== user.createdAt && (
              <span>Updated {timeAgo(user.updatedAt)}</span>
            )}
          </div>
        </div>

        <div className="shrink-0">
          <RoleSelector userId={user.id} role={user.role} isSelf={isSelf} />
        </div>

        <UserActions
          isSelf={isSelf}
          onResetPassword={onResetPassword}
          onDelete={onDelete}
        />
      </div>
    </Card>
  );
});
