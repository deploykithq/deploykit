import { Plus } from "lucide-react";

import { useUserList } from "@users/infrastructure/ui/hooks/useUserList";

import { Button } from "@shared/components/button";
import { ConfirmDialog } from "@shared/components/confirm-dialog";
import {
  CreateUserModal,
  ResetPasswordModal,
  RoleLegend,
  UserListContent,
} from "@users/infrastructure/ui/components";

export const UsersPage: React.FC = () => {
  const {
    users,
    isLoading,
    currentUserId,
    showCreateModal,
    openCreateModal,
    closeCreateModal,
    deleteTarget,
    setDeleteTarget,
    handleDeleteConfirm,
    isDeleting,
    resetTarget,
    setResetTarget,
    invalidateList,
  } = useUserList();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Manage who has access to this DeployKit instance
          </p>
        </div>
        <Button size="sm" onClick={openCreateModal}>
          <Plus className="w-3.5 h-3.5" />
          Create User
        </Button>
      </div>

      <RoleLegend />

      <UserListContent
        users={users}
        isLoading={isLoading}
        currentUserId={currentUserId}
        onCreateUser={openCreateModal}
        onDelete={(user) => setDeleteTarget({ id: user.id, email: user.email })}
        onResetPassword={(user) =>
          setResetTarget({ id: user.id, email: user.email })
        }
      />

      <CreateUserModal
        open={showCreateModal}
        onClose={closeCreateModal}
        onCreated={() => {
          closeCreateModal();
          invalidateList();
        }}
      />

      <ResetPasswordModal
        open={!!resetTarget}
        email={resetTarget?.email || ""}
        userId={resetTarget?.id || ""}
        onClose={() => setResetTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete User"
        description={`Permanently remove "${deleteTarget?.email}"? They will lose all access to this DeployKit instance.`}
        confirmText="Delete User"
        isPending={isDeleting}
      />
    </div>
  );
};
