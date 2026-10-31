import { forges } from '../forges/registry'
import { createDistribution } from './distribution'
import { createReaper } from './reaper'
import { createRunnersService } from './runners.service'

export const runnersService = createRunnersService(forges, createDistribution())
export const reaper = createReaper(forges)
