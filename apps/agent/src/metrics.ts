import { mkdir, statfs } from 'node:fs/promises'
import { cpus, freemem, totalmem } from 'node:os'
import { runCommand } from './vm/command'

// A reading of this machine's resources, as the poll reports it. CPU is the
// busy fraction (0 to 1) of all cores since the previous reading; the rest are
// bytes.
export type Metrics = {
  cpu: number
  memoryUsed: number
  memoryTotal: number
  diskUsed: number
  diskTotal: number
}

type CpuTimes = { busy: number; total: number }

const cpuTimes = (): CpuTimes => {
  let busy = 0
  let total = 0
  for (const { times } of cpus()) {
    const all = times.user + times.nice + times.sys + times.idle + times.irq
    busy += all - times.idle
    total += all
  }
  return { busy, total }
}

// macOS counts the file cache as used, so `os.freemem` reads near full on a
// machine that isn't: used memory is what Activity Monitor calls it, app
// memory (anonymous pages that can't be purged), wired and compressed.
export const parseVmStat = (output: string, total: number) => {
  const pageSize = Number(/page size of (\d+) bytes/.exec(output)?.[1])
  const pages = (label: string) => {
    const match = new RegExp(`^${label}:\\s+(\\d+)\\.`, 'm').exec(output)
    if (!match?.[1]) throw new Error(`vm_stat reported no "${label}"`)
    return Number(match[1])
  }
  if (!pageSize) throw new Error('vm_stat reported no page size')
  const used =
    (pages('Anonymous pages') -
      pages('Pages purgeable') +
      pages('Pages wired down') +
      pages('Pages occupied by compressor')) *
    pageSize
  return Math.min(Math.max(used, 0), total)
}

// Linux's MemAvailable counts the reclaimable cache as free, as `os.freemem`
// may not.
export const parseMeminfo = (meminfo: string, total: number) => {
  const available = /^MemAvailable:\s+(\d+) kB/m.exec(meminfo)?.[1]
  if (!available) throw new Error('/proc/meminfo reported no MemAvailable')
  return Math.min(Math.max(total - Number(available) * 1024, 0), total)
}

const memoryUsed = async (total: number) => {
  if (process.platform === 'darwin') {
    const { stdout } = await runCommand(['vm_stat'])
    return parseVmStat(stdout, total)
  }
  if (process.platform === 'linux') {
    return parseMeminfo(await Bun.file('/proc/meminfo').text(), total)
  }
  return total - freemem()
}

// The volume `path` is on: the space available to the agent, not the blocks
// only root can use, so a full disk reads as full. A fresh agent makes its
// data directory with its first job: it's made here if it isn't yet.
const disk = async (path: string) => {
  await mkdir(path, { recursive: true })
  const { blocks, bavail, bsize } = await statfs(path)
  const total = blocks * bsize
  return { diskUsed: total - bavail * bsize, diskTotal: total }
}

// Reads this machine's metrics: CPU since the previous reading (the first
// since the sampler was made), and the disk `dataDir` is on, where runner
// builds and VMs live.
export const createSampler = (dataDir: string) => {
  let previous = cpuTimes()
  return async (): Promise<Metrics> => {
    const current = cpuTimes()
    const total = current.total - previous.total
    const cpu = total > 0 ? (current.busy - previous.busy) / total : 0
    previous = current
    const memoryTotal = totalmem()
    return {
      cpu: Math.min(Math.max(cpu, 0), 1),
      memoryUsed: await memoryUsed(memoryTotal),
      memoryTotal,
      ...(await disk(dataDir)),
    }
  }
}

export type Sampler = ReturnType<typeof createSampler>
