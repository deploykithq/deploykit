interface CollapsibleSectionPropsI {
  title: string;
  /** Clave bajo la que se recuerda en localStorage si la sección está plegada. */
  storageKey: string;
  children: React.ReactNode;
  /** Número de elementos; se muestra junto al título para verlo aun plegada. */
  count?: number;
  /** Controles a la derecha de la cabecera (fuera del botón que pliega). */
  actions?: React.ReactNode;
  /** Sin preferencia guardada, la sección empieza plegada salvo que se indique. */
  defaultOpen?: boolean;
}

export type { CollapsibleSectionPropsI };
