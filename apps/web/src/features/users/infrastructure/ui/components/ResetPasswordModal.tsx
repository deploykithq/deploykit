import { memo } from "react";

import { useResetPassword } from "@users/infrastructure/ui/hooks/useResetPassword";

import { Button } from "@shared/components/button";
import { FormStatus } from "@shared/components/form-status";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";

interface ResetPasswordModalPropsI {
  open: boolean;
  email: string;
  userId: string;
  onClose: () => void;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalPropsI> = memo(
  function ResetPasswordModal({ open, email, userId, onClose }) {
    const {
      newPassword,
      setNewPassword,
      success,
      isPending,
      error,
      handleSubmit,
    } = useResetPassword(onClose);

    return (
      <Modal open={open} onClose={onClose} title="Reset Password">
        <p className="text-sm text-text-secondary mb-4">
          Set a new password for <strong>{email}</strong>
        </p>
        <form onSubmit={handleSubmit(userId)} className="space-y-4">
          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            minLength={8}
            required
          />

          <FormStatus
            success={success}
            successMessage="Password reset successfully"
            error={error}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || success}>
              {isPending ? "Resetting..." : "Reset Password"}
            </Button>
          </div>
        </form>
      </Modal>
    );
  },
);
