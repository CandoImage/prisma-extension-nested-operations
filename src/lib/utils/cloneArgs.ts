import { isDbNull, isJsonNull, isAnyNull } from "@prisma/client/runtime/client";
import { cloneDeepWith } from "lodash";

// Prisma 7 uses isDbNull/isJsonNull/isAnyNull helper functions instead of
// objectEnumValues.classes (removed in Prisma 7) to identify null type instances.
function passThroughNullTypes(value: any) {
  if (isDbNull(value) || isJsonNull(value) || isAnyNull(value)) {
    return value;
  }
}

export function cloneArgs(args: any) {
  return cloneDeepWith(args, passThroughNullTypes);
}
