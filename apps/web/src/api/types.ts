export type StepStatus = 'pending' | 'passed' | 'partial' | 'failed'

export interface GateStep {
  id: string
  label: string
  status: StepStatus
  detail: string
}

export interface GateReport {
  meta: Record<string, unknown>
  steps: GateStep[]
  notices: string[]
  verdict: string
}

export interface UploadResult {
  id: string
  url: string
  name: string
  width: number
  height: number
  has_alpha: boolean
  gate: GateReport
  meta: {
    source_format: string
    metadata_removed: string[]
    icc_applied: boolean
    orientation_applied: number
    frames: number
  }
}

export interface Rejection {
  code: string
  step: string
  message: string
  steps: GateStep[]
}

export interface SystemInfo {
  version: string
  limits: { max_file_bytes: number; max_batch_files: number }
}

export interface SecurityStatus {
  clamav: { available: boolean; required: boolean; install_hint: string | null }
  yara: { available: boolean; rules: number; error: string | null }
  sandbox: {
    kind: string
    memory_limit: boolean
    cpu_limit: boolean
    process_limit: boolean
    network_isolated: boolean
    notes: string[]
  }
  limits: { max_file_bytes: number; max_pixels: number; max_batch_files: number }
  allowed_formats: string[]
}

export type JobStatus = 'uploading' | 'queued' | 'checking' | 'done' | 'failed'

export interface Job {
  id: string
  name: string
  status: JobStatus
  label?: string
  step?: string
  progress: number
  error?: string
  image_id?: string
}
