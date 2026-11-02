import { queryOptions } from '@tanstack/react-query'
import { authClient } from '@/lib/auth'

// better-auth's client resolves with `{ data, error }`; queries want data or
// a throw.
const unwrapAuth = <Data>({
  data,
  error,
}: {
  data: Data | null
  error: { message?: string } | null
}): Data => {
  if (error) throw new Error(error.message ?? 'Something went wrong')
  return data as Data
}

// The ways the user signs in besides passkeys: `credential` (a password)
// and social providers such as `github`.
export const accountsQuery = queryOptions({
  queryKey: ['accounts'],
  queryFn: async () => unwrapAuth(await authClient.listAccounts()),
})
