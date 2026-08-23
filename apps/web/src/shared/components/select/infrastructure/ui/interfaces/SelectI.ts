interface SelectOptionI {
  value: string;
  label: string;
}

interface SelectPropsI extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOptionI[];
}

export type { SelectOptionI, SelectPropsI };
