/** Serializable viewer info passed from the server shell to client components. */
export type ViewerSummary =
  | { kind: "bypass" }
  | { kind: "unconfigured" }
  | { kind: "anonymous" }
  | { kind: "user"; id: string; email: string | null };
