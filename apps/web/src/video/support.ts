/**
 * What this system's web view can do with video. On Windows (WebView2) and in Chrome, Edge and Firefox,
 * WebCodecs is always there; on Linux the desktop app's web view (WebKitGTK) decodes through GStreamer, so
 * it depends on the plugins installed. When something is missing the editor says so and offers the fixes
 * instead of showing empty clips.
 */
import { useSyncExternalStore } from 'react'

export interface VideoSupport {
  decode: boolean
  encode: boolean
  linux: boolean
  /** The desktop app's own web view (not Chrome, Edge or Firefox), where a browser is a good fallback. */
  systemWebView: boolean
}

const H264 = 'avc1.42001f'

async function supported(kind: 'VideoDecoder' | 'VideoEncoder'): Promise<boolean> {
  const api = (
    window as unknown as Record<
      string,
      { isConfigSupported?: (c: object) => Promise<{ supported?: boolean }> }
    >
  )[kind]
  if (!api?.isConfigSupported) return false
  try {
    const config =
      kind === 'VideoDecoder'
        ? { codec: H264, codedWidth: 1280, codedHeight: 720 }
        : { codec: H264, width: 1280, height: 720, bitrate: 4_000_000 }
    return !!(await api.isConfigSupported(config)).supported
  } catch {
    return false
  }
}

let cached: Promise<VideoSupport> | null = null
export function videoSupport(): Promise<VideoSupport> {
  cached ??= (async () => {
    const ua = navigator.userAgent
    return {
      decode: await supported('VideoDecoder'),
      encode: await supported('VideoEncoder'),
      linux: /Linux/.test(ua) && !/Android/.test(ua),
      systemWebView: !/Chrome\/|Firefox\/|Edg\//.test(ua),
    }
  })()
  return cached
}

// files whose video track this system cannot decode (reported by media.ts)
const undecodable = new Set<string>()
const listeners = new Set<() => void>()
let snapshot: string[] = []
export function markUndecodable(mediaId: string): void {
  if (undecodable.has(mediaId)) return
  undecodable.add(mediaId)
  snapshot = [...undecodable]
  listeners.forEach((l) => l())
}
export function useUndecodable(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => snapshot,
  )
}

/** The commands that install the GStreamer plugins WebKitGTK uses for video, per Linux family. */
export const LINUX_PLUGINS = [
  {
    name: 'Ubuntu, Debian, Mint',
    command: 'sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav',
  },
  {
    name: 'Fedora',
    command: 'sudo dnf install gstreamer1-plugins-good gstreamer1-plugins-bad-free gstreamer1-plugin-libav',
  },
  { name: 'Arch, Manjaro', command: 'sudo pacman -S gst-plugins-good gst-plugins-bad gst-libav' },
] as const
