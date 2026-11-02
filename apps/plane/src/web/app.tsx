import { Redirect, Route, Switch } from 'wouter'
import { AppLayout } from '@/components/layout'
import { Agents } from '@/features/agents/page'
import { SignIn } from '@/features/auth/sign-in'
import { SignUp } from '@/features/auth/sign-up'
import { ForgeApps } from '@/features/forge-apps/page'
import {
  ForgeAppSetupError,
  ForgeAppSetupSuccess,
} from '@/features/forge-apps/setup'
import { Jobs } from '@/features/jobs/page'
import { Overview } from '@/features/overview/page'
import { Profile } from '@/features/profile/page'
import { authClient } from '@/lib/auth'

export const App = () => {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return null

  if (!session) {
    return (
      <Switch>
        <Route path="/login">
          <SignIn />
        </Route>
        <Route path="/signup">
          <SignUp />
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
        <Route path="/profile">
          <Profile />
        </Route>
        <Route path="/">
          <Overview />
        </Route>
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </AppLayout>
  )
}
