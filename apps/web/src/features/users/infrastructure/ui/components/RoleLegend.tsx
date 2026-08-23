import {
  ROLE_OPTIONS,
  ROLE_DESCRIPTIONS,
  ROLE_ICONS,
} from "@users/infrastructure/ui/constants/users.constants";

export const RoleLegend: React.FC = () => {
  return (
    <div className="flex gap-4 flex-wrap">
      {ROLE_OPTIONS.map((r) => {
        const Icon = ROLE_ICONS[r.value]!;
        return (
          <div
            key={r.value}
            className="flex items-center gap-2 text-xs text-text-secondary"
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="font-medium">{r.label}:</span>
            <span className="text-text-muted">
              {ROLE_DESCRIPTIONS[r.value]}
            </span>
          </div>
        );
      })}
    </div>
  );
};
