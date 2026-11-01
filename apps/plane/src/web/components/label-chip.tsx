// A runner label (`self-hosted`, `macos`, …), as agents have and jobs ask for.
export const LabelChip = ({ children }: { children: string }) => (
  <span className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs">
    {children}
  </span>
)
