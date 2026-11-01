import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'wouter'

// Page state kept in the URL, so a reload or a shared link shows the same
// view. Empty values are left out. Changes replace the history entry rather
// than adding one per keystroke.

const useSetParam = () => {
  const [, setParams] = useSearchParams()
  return useCallback(
    (key: string, value: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set(key, value)
          else next.delete(key)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
}

export const useParam = (key: string) => {
  const [params] = useSearchParams()
  const set = useSetParam()
  return [params.get(key) ?? '', (value: string) => set(key, value)] as const
}

// A comma-separated list, e.g. `?hide=agent,labels`. Stable while the URL
// doesn't change, so memoized filtering holds.
export const useListParam = (key: string) => {
  const [params] = useSearchParams()
  const set = useSetParam()
  const raw = params.get(key)
  const list = useMemo(() => (raw ? raw.split(',').filter(Boolean) : []), [raw])
  return [list, (value: string[]) => set(key, value.join(','))] as const
}

// One of `values`, falling back to (and leaving out of the URL) `fallback`.
export const useEnumParam = <Value extends string>(
  key: string,
  values: readonly Value[],
  fallback: Value,
) => {
  const [raw, set] = useParam(key)
  const value = values.includes(raw as Value) ? (raw as Value) : fallback
  return [value, (next: Value) => set(next === fallback ? '' : next)] as const
}
