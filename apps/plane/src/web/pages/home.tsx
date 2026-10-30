import type { Treaty } from '@elysia/eden'
import { LogOutIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
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

  useEffect(() => {
    void api.me.get().then(({ data }) => setUser(data))
  }, [])

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="font-semibold text-xl">Manica</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void authClient.signOut()}
        >
          <LogOutIcon data-icon="inline-start" />
          Sign out
        </Button>
      </header>
      {user && (
        <Card>
          <CardHeader>
            <CardTitle>{user.name}</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  )
}
