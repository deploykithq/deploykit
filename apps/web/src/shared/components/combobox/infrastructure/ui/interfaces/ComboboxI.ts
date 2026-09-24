interface ComboboxOptionI {
  value: string;
  label: string;
  /** Secondary text shown next to the label, e.g. "private". */
  hint?: string;
}

interface ComboboxPropsI {
  label?: string;
  options: ComboboxOptionI[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Shown when the filter matches nothing. */
  emptyLabel?: string;
  /** Shown under the field, e.g. a truncation warning. */
  note?: string;
  id?: string;
}

export type { ComboboxOptionI, ComboboxPropsI };
