import { ROLE_OPTIONS } from "@users/infrastructure/ui/constants/users.constants";

type RoleValueT = (typeof ROLE_OPTIONS)[number]["value"];

export type { RoleValueT };
