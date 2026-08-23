import { memo } from "react";
import { Plus, Users } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { EmptyState } from "@shared/components/empty-state";
import { UserCard } from "@users/infrastructure/ui/components";

interface UserListContentPropsI {
  users: any[] | undefined;
  isLoading: boolean;
  currentUserId: string | undefined;
  onCreateUser: () => void;
  onDelete: (user: { id: string; email: string }) => void;
  onResetPassword: (user: { id: string; email: string }) => void;
}

export const UserListContent: React.FC<UserListContentPropsI> = memo(
  function UserListContent({
    users,
    isLoading,
    currentUserId,
    onCreateUser,
    onDelete,
    onResetPassword,
  }) {
    if (isLoading) {
      return <div className="text-sm text-text-muted p-6">Loading...</div>;
    }

    if (!users?.length) {
      return (
        <Card>
          <EmptyState
            icon={<Users className="w-5 h-5" />}
            title="No users"
            description="Create your first user to grant access."
            action={
              <Button size="sm" onClick={onCreateUser}>
                <Plus className="w-3.5 h-3.5" />
                Create User
              </Button>
            }
          />
        </Card>
      );
    }

    return (
      <div className="space-y-2">
        {users.map((user) => (
          <UserCard
            key={user.id}
            user={user}
            isSelf={user.id === currentUserId}
            onDelete={() => onDelete(user)}
            onResetPassword={() => onResetPassword(user)}
          />
        ))}
      </div>
    );
  },
);
