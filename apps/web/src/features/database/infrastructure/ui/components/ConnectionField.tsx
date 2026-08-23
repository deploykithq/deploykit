import { memo, useState } from "react";
import { Copy, Check } from "lucide-react";

import { cn } from "@lib/utils";

import { COPY_FEEDBACK_MS } from "@database/infrastructure/ui/constants/database.constants";

interface ConnectionFieldPropsI {
  label: string;
  value: string;
  mono?: boolean;
}

export const ConnectionField: React.FC<ConnectionFieldPropsI> = memo(
  function ConnectionField({ label, value, mono }) {
    const [copied, setCopied] = useState<boolean>(false);

    const handleCopy = () => {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    };

    return (
      <div>
        <label className="text-xs text-text-muted">{label}</label>
        <div className="flex items-center gap-1.5 mt-0.5">
          <code
            className={cn(
              "flex-1 px-2.5 py-1.5 rounded bg-surface-2 border border-border text-xs truncate",
              mono ? "font-mono text-text-secondary" : "text-text-primary",
            )}
          >
            {value}
          </code>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors shrink-0"
            title="Copy"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-success" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    );
  },
);
