import { PASSKEY_ERROR_CODES } from '@better-auth/passkey/client'
import type { Treaty } from '@elysia/eden'
import { KeyRoundIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GitHubIcon } from '@/components/brand-icon'
import { Alert, AlertDescription } from '@/components/ui/alert'
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

// Signs in with one of the user's passkeys. Only for signing in: a passkey
// is added to an existing account, from the profile.
const PasskeySignIn = () => {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
    setPending(true)
    setError(null)
    const { error } = await authClient.signIn.passkey()
    setPending(false)
    // Closing the browser's prompt isn't worth a message.
    if (error && error.message !== PASSKEY_ERROR_CODES.AUTH_CANCELLED.message) {
      setError(error.message ?? 'Something went wrong')
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() => void signIn()}
      >
        {pending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <KeyRoundIcon data-icon="inline-start" />
        )}
        Sign in with a passkey
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </>
  )
}

const GitHubSignIn = () => {
  const [leaving, setLeaving] = useState(false)
  return (
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
  )
}

// The ways in besides email and password, under an "or": a passkey when
// `passkey` (signing in), and GitHub when plane has it turned on. GitHub
// signs in or signs up alike: GitHub says who the user is.
export const OtherSignIn = ({ passkey = false }: { passkey?: boolean }) => {
  const methods = useSignInMethods()
  const github = !!methods?.github

  if (!passkey && !github) return null
  return (
    <>
      <div className="flex items-center gap-3 text-muted-foreground text-xs uppercase">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-3">
        {passkey && <PasskeySignIn />}
        {github && <GitHubSignIn />}
      </div>
    </>
  )
}
