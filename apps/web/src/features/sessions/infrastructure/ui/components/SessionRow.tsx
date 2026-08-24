import { memo } from "react";
import { LogOut } from "lucide-react";

import {
  STATUS_LABELS,
  STATUS_STYLES,
} from "@sessions/infrastructure/ui/constants/sessions.constants";
import {
  formatDate,
  formatUserAgent,
  timeAgo,
  timeUntil,
} from "@sessions/infrastructure/ui/utils/sessions.utils";

import type { SessionEntryI } from "@sessions/infrastructure/ui/interfaces/sessions.interfaces";

interface SessionRowPropsI {
  session: SessionEntryI;
  onRevoke: (session: SessionEntryI) => void;
}

export const SessionRow: React.FC<SessionRowPropsI> = memo(
  function SessionRow({ session, onRevoke }) {
    const isActive = session.status === "active";

    return (
      <tr className="border-b border-border text-sm">
        {/* User */}
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="flex flex-col">
            <span className="font-mono text-xs text-text-primary">
              {session.userEmail}
            </span>
            <span className="text-xs text-text-muted">{session.userRole}</span>
          </div>
        </td>

        {/* Status */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span
            className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_STYLES[session.status]}`}
          >
            {STATUS_LABELS[session.status]}
          </span>
        </td>

        {/* IP */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="font-mono text-xs text-text-muted">
            {session.ip ?? "—"}
          </span>
        </td>

        {/* Device */}
        <td className="px-4 py-3">
          <span
            className="text-text-secondary text-xs"
            title={session.userAgent ?? undefined}
          >
            {formatUserAgent(session.userAgent)}
          </span>
        </td>

        {/* Started */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span
            className="text-text-secondary text-xs"
            title={formatDate(session.createdAt)}
          >
            {timeAgo(session.createdAt)}
          </span>
        </td>

        {/* Last activity */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span
            className="text-text-secondary text-xs"
            title={formatDate(session.lastUsedAt)}
          >
            {timeAgo(session.lastUsedAt)}
          </span>
        </td>

        {/* Expires */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span
            className="text-text-muted text-xs"
            title={formatDate(session.expiresAt)}
          >
            {isActive ? timeUntil(session.expiresAt) : "—"}
          </span>
        </td>

        {/* Revocar solo tiene sentido sobre una sesión todavía viva */}
        <td className="px-4 py-3 text-right">
          {isActive && (
            <button
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-secondary hover:text-danger hover:bg-surface-2 transition-colors"
              onClick={() => onRevoke(session)}
              title="Revoke this session"
            >
              <LogOut className="w-3.5 h-3.5" />
              Revoke
            </button>
          )}
        </td>
      </tr>
    );
  },
);
