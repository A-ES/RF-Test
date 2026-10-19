/**
 * Determines whether a given user session role has catalog & inventory write permissions.
 * Non-negotiable rule: CLIENT_ADMIN and ADMIN have write access; other roles are read-only.
 */
export function canWriteCatalog(role?: string | null): boolean {
  if (!role) return false;
  return role === "ADMIN" || role === "CLIENT_ADMIN";
}
