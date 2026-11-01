import { BarChart3Icon, BoxIcon, PlayIcon, ServerIcon } from 'lucide-react'
import type { ReactNode } from 'react'

const points = [
  {
    icon: PlayIcon,
    title: 'Run jobs',
    detail: 'Queued workflow jobs run on machines you own.',
  },
  {
    icon: ServerIcon,
    title: 'Manage agents',
    detail: 'Register machines and choose which jobs they take.',
  },
  {
    icon: BarChart3Icon,
    title: 'Stay in control',
    detail: 'Follow jobs and agents as they run, in real time.',
  },
]

const Tile = ({ children }: { children: ReactNode }) => (
  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-card">
    {children}
  </span>
)

// The pitch on the left, the form on the right; the pitch gives way on
// narrow screens.
export const AuthLayout = ({ children }: { children: ReactNode }) => (
  <main className="relative flex min-h-svh items-center justify-center overflow-hidden p-6 md:p-10">
    {/* Faint vertical rules framing the page. */}
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 mx-auto max-w-6xl border-x border-border/40"
    />
    <div className="relative grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1fr_auto_1fr]">
      <section className="hidden flex-col gap-8 lg:flex">
        <div className="flex items-center gap-3">
          <Tile>
            <BoxIcon className="size-5" />
          </Tile>
          <span className="font-semibold text-lg">Manica</span>
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="font-semibold text-4xl tracking-tight">
            Run and manage
            <br />
            your agents.
          </h1>
          <p className="max-w-sm text-muted-foreground">
            Run your CI jobs on your own machines, and keep an eye on them in
            one place.
          </p>
        </div>
        <ul className="flex flex-col gap-5">
          {points.map(({ icon: Icon, title, detail }) => (
            <li key={title} className="flex items-center gap-4">
              <Tile>
                <Icon className="size-4" />
              </Tile>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-sm">{title}</span>
                <span className="text-muted-foreground text-sm">{detail}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div aria-hidden className="hidden h-full w-px bg-border lg:block" />
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        {/* The brand, where the pitch is hidden. */}
        <div className="flex items-center gap-3 lg:hidden">
          <Tile>
            <BoxIcon className="size-5" />
          </Tile>
          <span className="font-semibold text-lg">Manica</span>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </div>
    </div>
  </main>
)
