import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// A card of the profile page: what it's about on the left, its controls on
// the right (stacked on narrow screens).
export const ProfileSection = ({
  icon: Icon,
  title,
  description,
  destructive = false,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  destructive?: boolean
  children: ReactNode
}) => (
  <section
    aria-labelledby={`profile-${title}`}
    className="grid gap-6 rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:gap-8"
  >
    <div className="flex items-start gap-4">
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ${
          destructive
            ? 'bg-destructive/10 text-destructive ring-destructive/20'
            : 'bg-muted text-muted-foreground ring-foreground/10'
        }`}
      >
        <Icon className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 id={`profile-${title}`} className="font-medium">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
    <div className="flex min-w-0 flex-col gap-4 md:border-l md:pl-8">
      {children}
    </div>
  </section>
)
