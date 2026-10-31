import { Redirect, Route, Switch } from 'wouter'
import { AppLayout } from '@/components/layout'
import { authClient } from '@/lib/auth'
import { Agents } from '@/pages/agents'
import {
  ForgeAppSetupError,
  ForgeAppSetupSuccess,
} from '@/pages/forge-app-setup'
import { ForgeApps } from '@/pages/forge-apps'
import { Home } from '@/pages/home'
import { Jobs } from '@/pages/jobs'
import { Login } from '@/pages/login'

export const App = () => {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return null

  if (!session) {
    return (
      <Switch>
        <Route path="/login">
          <Login />
        </Route>
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    )
  }

  return (
    <AppLayout>
      <Switch>
        <Route path="/forge-apps/setup/success">
          <ForgeAppSetupSuccess />
        </Route>
        <Route path="/forge-apps/setup/error">
          <ForgeAppSetupError />
        </Route>
        <Route path="/jobs">
          <Jobs />
        </Route>
        <Route path="/agents">
          <Agents />
        </Route>
        <Route path="/forge-apps">
          <ForgeApps />
        </Route>
        <Route path="/">
          <Home />
        </Route>
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </AppLayout>
  )
}
