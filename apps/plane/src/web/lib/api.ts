import { treaty } from '@elysia/eden'
import type { App } from '../../app'

export const api = treaty<App>(window.location.origin).api
