// Marks an agent or forge app disabled for being past its organization's
// billing owner's plan, by itself or with its whole organization (see
// `features/billing`).
export const DisabledBadge = ({ what }: { what: string }) => (
  <span
    title={`Past the plan's limit: this ${what}, or its whole organization, is disabled until the organization's billing owner upgrades or makes room, from Billing.`}
    className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 font-medium text-amber-700 text-xs dark:text-amber-400"
  >
    Disabled
  </span>
)
