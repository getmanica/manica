import { isAdmin } from '@shared/admin'
import type { UserSort } from '@shared/pagination'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { UsersIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createDataTableColumnHelper, DataTable } from '@/components/data-table'
import { Page } from '@/components/layout'
import { LoadError } from '@/components/loading'
import { TableFilter } from '@/components/table-filter'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { BanUserDialog } from '@/features/admin/ban-user-dialog'
import { ConfirmUserActionDialog } from '@/features/admin/confirm-user-action-dialog'
import { type UserAction, UserActions } from '@/features/admin/user-actions'
import { type AdminUser, usersKey, usersQuery } from '@/features/admin/users'
import { authClient } from '@/lib/auth'
import { userAvatar } from '@/lib/avatar'
import { formatDate, formatTime } from '@/lib/format'
import { RequestError } from '@/lib/query'

const route = getRouteApi('/_signedIn/admin/users')

const column = createDataTableColumnHelper<AdminUser>()

const Badge = ({
  tone,
  children,
}: {
  tone: 'muted' | 'red' | 'blue'
  children: string
}) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs ${
      {
        muted: 'bg-muted text-muted-foreground',
        red: 'bg-red-500/15 text-red-700 dark:text-red-400',
        blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
      }[tone]
    }`}
  >
    {children}
  </span>
)

const Status = ({ user }: { user: AdminUser }) =>
  user.banned ? (
    <div className="flex flex-col items-start gap-1">
      <Badge tone="red">Banned</Badge>
      <span className="whitespace-normal text-muted-foreground text-xs">
        {user.banExpires
          ? `Until ${formatDate(user.banExpires)}, ${formatTime(user.banExpires)}`
          : 'Until unbanned'}
        {user.banReason && ` · ${user.banReason}`}
      </span>
    </div>
  ) : (
    <Badge tone="muted">Active</Badge>
  )

const dataColumns = [
  column.accessor('name', {
    header: 'User',
    enableHiding: false,
    cell: ({ row: { original: user } }) => (
      <div className="flex items-center gap-3">
        <Avatar>
          <AvatarImage src={user.image ?? userAvatar(user.id)} alt="" />
        </Avatar>
        <div className="flex flex-col">
          <span className="font-medium">{user.name}</span>
          <span className="text-muted-foreground text-xs">{user.email}</span>
        </div>
      </div>
    ),
  }),
  column.accessor('role', {
    header: 'Role',
    cell: ({ row: { original: user } }) =>
      isAdmin(user.role) ? (
        <Badge tone="blue">Admin</Badge>
      ) : (
        <span className="text-muted-foreground">User</span>
      ),
  }),
  column.accessor('banned', {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => <Status user={row.original} />,
  }),
  column.accessor('organizations', {
    header: 'Organizations',
    enableSorting: false,
  }),
  column.accessor('createdAt', {
    header: 'Joined',
    sortDescFirst: true,
    cell: ({ row: { original: user } }) => (
      <div className="flex flex-col">
        <span>{formatDate(user.createdAt)}</span>
        <span className="text-muted-foreground text-xs">
          {formatTime(user.createdAt)}
        </span>
      </div>
    ),
  }),
]

const Empty = ({ title, detail }: { title: string; detail: string }) => (
  <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
    <UsersIcon className="mb-2 size-6 text-muted-foreground" />
    <p className="font-medium text-sm">{title}</p>
    <p className="whitespace-normal text-muted-foreground text-sm">{detail}</p>
  </div>
)

const UserList = () => {
  const queryClient = useQueryClient()
  const { data: session, refetch: refetchSession } = authClient.useSession()
  const selfId = session?.user.id
  // The open dialog, if any. The user it acts on outlives it, so the dialog
  // keeps its content while it animates closed.
  const [dialog, setDialog] = useState<UserAction | null>(null)
  const [target, setTarget] = useState<AdminUser>()
  const current = route.useSearch()
  const { q: text, page, size } = current
  const navigate = route.useNavigate()
  // Replaces the history entry rather than adding one per keystroke. Any
  // change but the page starts over from the first page.
  const update = (search: Partial<typeof current>) =>
    void navigate({
      search: (prev) => ({
        ...prev,
        ...(Object.keys(search).some((key) => key !== 'page')
          ? { page: 1 }
          : {}),
        ...search,
      }),
      replace: true,
    })

  // The API is asked once typing pauses, not for every keystroke.
  const [q] = useDebouncedValue(text, { wait: 250 })
  const query = useQuery(
    usersQuery({
      q: q || undefined,
      page,
      size,
      sort: current.sort,
      dir: current.dir,
    }),
  )
  const list = query.data

  // Refused: the viewer was signed out or demoted since the session was
  // read (by another admin, say). Reading it again runs the route guards,
  // which take them out of the admin section.
  // Once per refusal, so a failed refetch is retried with the next one.
  const refusedAt =
    query.error instanceof RequestError &&
    (query.error.status === 401 || query.error.status === 403)
      ? query.errorUpdatedAt
      : undefined
  useEffect(() => {
    if (refusedAt !== undefined) void refetchSession()
  }, [refusedAt, refetchSession])

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: usersKey })

  const columns = useMemo(
    () =>
      column.columns([
        ...dataColumns,
        column.display({
          id: 'actions',
          enableHiding: false,
          header: () => <span className="sr-only">Actions</span>,
          cell: ({ row }) => (
            <div className="flex justify-end">
              <UserActions
                user={row.original}
                self={row.original.id === selfId}
                onAction={(action, user) => {
                  setTarget(user)
                  setDialog(action)
                }}
              />
            </div>
          ),
        }),
      ]),
    [selfId],
  )

  const filtered = text.trim() !== ''

  const dialogProps = (kind: UserAction) => ({
    open: dialog === kind,
    onOpenChange: (open: boolean) => setDialog(open ? kind : null),
  })

  return (
    <>
      <DataTable
        columns={columns}
        data={list?.items ?? []}
        getRowId={(user) => user.id}
        sorting={{ id: current.sort, desc: current.dir === 'desc' }}
        onSortingChange={({ id, desc }) =>
          update({ sort: id as UserSort, dir: desc ? 'desc' : 'asc' })
        }
        pagination={{
          page,
          size,
          total: list?.total,
          onPageChange: (page) => update({ page }),
          onSizeChange: (size) => update({ size }),
        }}
        loading={query.isPending}
        dimmed={query.isPlaceholderData || q !== text}
        error={
          query.isError &&
          !list && (
            <LoadError
              title="Couldn't load users"
              error={query.error}
              retrying={query.isFetching}
              onRetry={() => void query.refetch()}
            />
          )
        }
        toolbar={
          <>
            <div className="mr-auto w-full max-w-xs">
              <TableFilter
                value={text}
                onChange={(q) => update({ q })}
                placeholder="Filter by name or email…"
              />
            </div>
            {list && !filtered && (
              <span className="shrink-0 px-2 text-muted-foreground text-sm">
                {list.total} {list.total === 1 ? 'user' : 'users'}
              </span>
            )}
          </>
        }
        empty={
          filtered ? (
            <Empty title="No matching users" detail="Try another filter." />
          ) : (
            <Empty
              title="No users yet"
              detail="Users appear once they sign up."
            />
          )
        }
      />
      <BanUserDialog {...dialogProps('ban')} user={target} onBanned={refresh} />
      {(
        ['make-admin', 'remove-admin', 'unban', 'sign-out', 'remove'] as const
      ).map((action) => (
        <ConfirmUserActionDialog
          key={action}
          {...dialogProps(action)}
          action={action}
          user={target}
          onDone={refresh}
        />
      ))}
    </>
  )
}

export const AdminUsers = () => (
  <Page
    wide
    title="Users"
    eyebrow="Admin"
    description="Everyone with an account on this plane, across organizations."
  >
    <UserList />
  </Page>
)
