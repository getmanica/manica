import { CircleAlertIcon, RotateCwIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

// Wraps placeholders for content on its way: fades them in after a beat, and
// tells assistive tech the region is busy.
export const Loading = ({
  label = 'Loading…',
  className = '',
  children,
}: {
  label?: string
  className?: string
  children: ReactNode
}) => (
  <div aria-busy className={`animate-delayed-in ${className}`}>
    <span className="sr-only">{label}</span>
    {children}
  </div>
)

// In place of content whose request failed, with a way to try again.
export const LoadError = ({
  title,
  error,
  retrying,
  onRetry,
}: {
  title: string
  error: Error
  retrying: boolean
  onRetry: () => void
}) => (
  <Alert variant="destructive">
    <CircleAlertIcon />
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
      {error.message}
      <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
        {retrying ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <RotateCwIcon data-icon="inline-start" />
        )}
        Try again
      </Button>
    </AlertDescription>
  </Alert>
)
