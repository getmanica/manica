import { HTTPError } from 'elysia'

export class RunnerNotFoundError extends HTTPError.id(
  'RUNNER_NOT_FOUND',
  404,
) {}
