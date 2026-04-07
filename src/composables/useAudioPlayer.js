/**
 * useAudioPlayer — Global singleton audio player state
 *
 * Manages a single Audio() element that persists across Vue view changes.
 * Used by AnalysisView (inline mini-player), SecReportDetail, and
 * FloatingAudioPlayer (shows when navigating away while audio plays).
 */
import { ref, computed } from 'vue'

// ── Singleton state (module-level, shared across all imports) ──
const audioEl = ref(null)          // The HTML Audio element
const isPlaying = ref(false)
const currentProgress = ref(0)     // seconds
const currentDuration = ref(0)     // seconds
const currentReport = ref(null)    // { id, ticker, reportType, periodCurrent, audioUrl, entityName }
let progressInterval = null

function startProgressTracking() {
  clearInterval(progressInterval)
  progressInterval = setInterval(() => {
    if (audioEl.value) {
      currentProgress.value = audioEl.value.currentTime
      currentDuration.value = audioEl.value.duration || 0
    }
  }, 250)
}

function stopProgressTracking() {
  clearInterval(progressInterval)
  progressInterval = null
}

// ── Public API ──

/**
 * Play a report's audio. If same report is playing, toggle pause/resume.
 * If a different report is playing, stop it and play the new one.
 */
function play(report) {
  if (!report?.audioUrl) return

  // Same report — toggle pause/resume
  if (currentReport.value?.id === report.id && audioEl.value) {
    if (isPlaying.value) {
      audioEl.value.pause()
      return
    } else {
      audioEl.value.play()
      return
    }
  }

  // Different report or first play — stop current, create new
  stop()

  currentReport.value = {
    id: report.id,
    ticker: report.ticker,
    reportType: report.reportType,
    periodCurrent: report.periodCurrent,
    audioUrl: report.audioUrl,
    entityName: report.entityName || report.ticker,
  }

  const el = new Audio(report.audioUrl)
  audioEl.value = el

  el.addEventListener('play', () => {
    isPlaying.value = true
    startProgressTracking()
  })
  el.addEventListener('pause', () => {
    isPlaying.value = false
    stopProgressTracking()
  })
  el.addEventListener('ended', () => {
    isPlaying.value = false
    currentProgress.value = 0
    stopProgressTracking()
  })

  el.play()
}

/** Stop and clean up audio completely */
function stop() {
  stopProgressTracking()
  if (audioEl.value) {
    audioEl.value.pause()
    audioEl.value.src = ''
    audioEl.value = null
  }
  isPlaying.value = false
  currentProgress.value = 0
  currentDuration.value = 0
  currentReport.value = null
}

/** Seek to a percentage (0–1) of the track */
function seekTo(pct) {
  if (!audioEl.value || !currentDuration.value) return
  audioEl.value.currentTime = pct * currentDuration.value
}

/** Seek to a specific time in seconds */
function seekToTime(seconds) {
  if (!audioEl.value) return
  audioEl.value.currentTime = seconds
}

// ── Computed helpers ──
const progressPct = computed(() => {
  if (!currentDuration.value) return 0
  return (currentProgress.value / currentDuration.value) * 100
})

const isActive = computed(() => !!currentReport.value)

const playingReportId = computed(() => currentReport.value?.id || null)

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function useAudioPlayer() {
  return {
    // State (reactive)
    isPlaying,
    isActive,
    currentProgress,
    currentDuration,
    currentReport,
    progressPct,
    playingReportId,
    // Actions
    play,
    stop,
    seekTo,
    seekToTime,
    // Helpers
    fmtTime,
  }
}
