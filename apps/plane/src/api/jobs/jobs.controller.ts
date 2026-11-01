import { Elysia } from 'elysia'
import { authMacro } from '../auth/session'
import { jobsService } from './jobs.service'

export const jobsController = new Elysia({ prefix: '/jobs' })
  .use(authMacro)
  .get('/', { organization: true }, ({ organizationId }) =>
    jobsService.list(organizationId),
  )
