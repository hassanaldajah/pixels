import { create } from 'zustand'
import type { Job } from '../api/types'
import { jobsSocketUrl } from '../api/client'

interface JobsState {
  jobs: Job[]
  socket: 'connecting' | 'open' | 'closed'
  upsert: (patch: Pick<Job, 'id'> & Partial<Job>) => void
  clearFinished: () => void
  connect: () => () => void
}

const MAX_JOBS = 30

export const useJobs = create<JobsState>((set, get) => ({
  jobs: [],
  socket: 'closed',
  upsert: (patch) =>
    set((state) => {
      const existing = state.jobs.find((j) => j.id === patch.id)
      if (existing) {
        // Never let a late event move a finished job backwards.
        if ((existing.status === 'done' || existing.status === 'failed') && patch.status !== existing.status)
          return state
        return { jobs: state.jobs.map((j) => (j.id === patch.id ? { ...j, ...patch } : j)) }
      }
      const job: Job = { name: 'image', status: 'queued', progress: 0, ...patch }
      return { jobs: [job, ...state.jobs].slice(0, MAX_JOBS) }
    }),
  clearFinished: () =>
    set((s) => ({ jobs: s.jobs.filter((j) => j.status !== 'done' && j.status !== 'failed') })),
  connect: () => {
    let socket: WebSocket | null = null
    let timer: number | undefined
    let stopped = false
    let attempt = 0
    const open = () => {
      set({ socket: 'connecting' })
      socket = new WebSocket(jobsSocketUrl())
      socket.onopen = () => {
        attempt = 0
        set({ socket: 'open' })
      }
      socket.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as { type: string; jobs?: Job[] } & Partial<Job>
        if (message.type === 'job' && message.id) get().upsert(message as Job)
      }
      socket.onclose = () => {
        set({ socket: 'closed' })
        if (!stopped) timer = window.setTimeout(open, Math.min(10_000, 500 * 2 ** attempt++))
      }
    }
    open()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      socket?.close()
    }
  },
}))
