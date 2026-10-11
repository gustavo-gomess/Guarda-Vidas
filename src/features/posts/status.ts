/** Operational state of a post. Provisional values (OD-03). */
export type PostStatus = "OPERATING" | "SUSPENDED" | "INACTIVE";

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  OPERATING: "Em operação",
  SUSPENDED: "Fora de operação temporariamente",
  INACTIVE: "Desativado",
};

export const POST_STATUS_OPTIONS = (
  Object.entries(POST_STATUS_LABELS) as [PostStatus, string][]
).map(([value, label]) => ({ value, label }));
