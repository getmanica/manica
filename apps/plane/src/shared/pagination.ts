// How the console's tables page through and sort what the API lists. The API
// does both, so only one page of rows ever reaches the browser.

export const pageSizes = [10, 25, 50, 100] as const
export type PageSize = (typeof pageSizes)[number]

export const defaultPageSize: PageSize = 10

export const sortDirections = ['asc', 'desc'] as const
export type SortDirection = (typeof sortDirections)[number]

// The columns each list sorts by, as its table names them.
export const jobSorts = [
  'name',
  'repository',
  'outcome',
  'agent',
  'labels',
  'queuedAt',
] as const
export type JobSort = (typeof jobSorts)[number]

export const agentSorts = [
  'name',
  'platform',
  'running',
  'version',
  'lastSeenAt',
  'createdAt',
] as const
export type AgentSort = (typeof agentSorts)[number]

export const forgeAppSorts = ['name', 'owner', 'status', 'createdAt'] as const
export type ForgeAppSort = (typeof forgeAppSorts)[number]

export const userSorts = ['name', 'role', 'status', 'createdAt'] as const
export type UserSort = (typeof userSorts)[number]

// What a page of a list holds: its rows, and how many rows match in all.
export type Paged<Item> = { items: Item[]; total: number }
