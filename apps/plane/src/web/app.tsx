import { Redirect, Route, Switch } from 'wouter'
import { authClient } from '@/lib/auth'
import { Home } from '@/pages/home'
import { Login } from '@/pages/login'

export const App = () => {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return null

  return (
    <Switch>
      <Route path="/login">{session ? <Redirect to="/" /> : <Login />}</Route>
      <Route path="/">{session ? <Home /> : <Redirect to="/login" />}</Route>
      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  )
}
