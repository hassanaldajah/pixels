import { AnimatePresence, motion } from 'motion/react'
import { useJobs } from '../state/jobs'
import { useUi } from '../state/ui'
import { Icon } from './Icon'

const STATUS_LABEL = {
  uploading: 'Uploading',
  queued: 'Queued',
  checking: 'Checking',
  done: 'Done',
  failed: 'Rejected',
} as const

function JobQueue() {
  const jobs = useJobs((s) => s.jobs)
  const clear = useJobs((s) => s.clearFinished)
  if (jobs.length === 0)
    return <p className="muted">Imports and, later, AI jobs appear here with live progress.</p>
  return (
    <div className="jobs">
      <ul>
        <AnimatePresence initial={false}>
          {jobs.map((job) => (
            <motion.li
              key={job.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              data-status={job.status}
            >
              <div className="job-line">
                <span className="job-name" title={job.name}>
                  {job.name}
                </span>
                <span className="job-status">{job.error ?? job.label ?? STATUS_LABEL[job.status]}</span>
              </div>
              <div
                className="bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(job.progress * 100)}
              >
                <div className="bar-fill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <button type="button" className="link-button" onClick={clear}>
        Clear finished
      </button>
    </div>
  )
}

export function JobsDock() {
  const open = useUi((s) => s.dockOpen)
  const set = useUi((s) => s.set)
  const jobs = useJobs((s) => s.jobs)
  const socket = useJobs((s) => s.socket)
  const active = jobs.filter((j) => j.status !== 'done' && j.status !== 'failed').length

  return (
    <footer className="dock glass" data-open={open}>
      <div className="dock-head">
        <button
          type="button"
          className="section-head"
          aria-expanded={open}
          onClick={() => set({ dockOpen: !open })}
          title="Toggle activity (Ctrl+J)"
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
          <span>Activity</span>
        </button>
        <span className="dock-meta">
          {active > 0 ? `${active} running` : `${jobs.length} recent`}
          <span className="dot" data-state={socket} title={`Live updates: ${socket}`} />
        </span>
      </div>
      {open && (
        <div className="dock-body dock-body-single">
          <JobQueue />
        </div>
      )}
    </footer>
  )
}
