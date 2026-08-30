import { Package } from "lucide-react";

/**
 * Icono por defecto cuando el blueprint no trae logo, o cuando el archivo no
 * carga (el registro remoto puede estar caído y las tarjetas deben seguir
 * siendo legibles).
 */
const FallbackTemplateIcon = Package;

/** Cuántas etiquetas se muestran como filtros antes de plegar el resto. */
const VISIBLE_TAG_FILTERS = 12;

export { FallbackTemplateIcon, VISIBLE_TAG_FILTERS };
