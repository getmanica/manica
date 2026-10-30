import type { Treaty } from '@elysia/eden'
import { useEffect, useState } from 'react'
import { Page } from '@/components/layout'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api } from '@/lib/api'
import { authClient } from '@/lib/auth'

type User = Treaty.Data<typeof api.me.get>

export const Home = () => {
  const [user, setUser] = useState<User | null>(null)
  const { data: organization } = authClient.useActiveOrganization()

  useEffect(() => {
    void api.me.get().then(({ data }) => setUser(data))
  }, [])

  return (
    <Page
      title="Overview"
      description={user ? `Welcome back, ${user.name}.` : undefined}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {user && (
          <Card>
            <CardHeader>
              <CardDescription>Account</CardDescription>
              <CardTitle>{user.name}</CardTitle>
              <CardDescription>{user.email}</CardDescription>
            </CardHeader>
          </Card>
        )}
        {organization && (
          <Card>
            <CardHeader>
              <CardDescription>Organization</CardDescription>
              <CardTitle>{organization.name}</CardTitle>
              <CardDescription>
                {organization.members.length}{' '}
                {organization.members.length === 1 ? 'member' : 'members'}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </Page>
  )
}
