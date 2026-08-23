import { memo } from "react";
import { KeyRound, Trash2 } from "lucide-react";

import { Button } from "@shared/components/button";

interface UserActionsPropsI {
  isSelf: boolean;
  onResetPassword: () => void;
  onDelete: () => void;
}

export const UserActions: React.FC<UserActionsPropsI> = memo(
  function UserActions({ isSelf, onResetPassword, onDelete }) {
    if (isSelf) return null;

    return (
      <div className="flex gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetPassword}
          title="Reset password"
        >
          <KeyRound className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          title="Delete user"
        >
          <Trash2 className="w-3.5 h-3.5 text-danger" />
        </Button>
      </div>
    );
  },
);
