import type { Treaty } from '@elysia/eden'
import { useEffect, useState } from 'react'
import { GitHubIcon } from '@/components/brand-icon'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api'
import { authClient } from '@/lib/auth'

type SignInMethods = Treaty.Data<(typeof api)['sign-in-methods']['get']>

// The sign-in methods plane has turned on, once known.
const useSignInMethods = () => {
  const [methods, setMethods] = useState<SignInMethods | null>(null)
  useEffect(() => {
    void api['sign-in-methods'].get().then(({ data }) => setMethods(data))
  }, [])
  return methods
}

// "Continue with GitHub", under an "or", when GitHub sign-in is turned on.
// It signs in or signs up alike: GitHub says who the user is.
export const GitHubSignIn = () => {
  const methods = useSignInMethods()
  const [leaving, setLeaving] = useState(false)

  if (!methods?.github) return null
  return (
    <>
      <div className="flex items-center gap-3 text-muted-foreground text-xs uppercase">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={leaving}
        onClick={() => {
          setLeaving(true)
          void authClient.signIn.social({
            provider: 'github',
            callbackURL: '/',
            errorCallbackURL: '/login',
          })
        }}
      >
        {leaving ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <GitHubIcon data-icon="inline-start" />
        )}
        Continue with GitHub
      </Button>
    </>
  )
}
