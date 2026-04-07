<script setup>
import { computed } from 'vue'
import { useAudioPlayer } from '@/composables/useAudioPlayer'

const props = defineProps({
  sidebarOpen: { type: Boolean, default: false },
})

const {
  isPlaying, isActive, currentProgress, currentDuration,
  currentReport, progressPct, play, stop, seekTo, fmtTime,
} = useAudioPlayer()

const showFloating = isActive
const collapsed = computed(() => props.sidebarOpen)

// SVG circular progress: radius=23, circumference=2*PI*23≈144.51
const CIRC = 144.51
const circOffset = computed(() => CIRC - (CIRC * progressPct.value / 100))

function onToggle() {
  if (currentReport.value) play(currentReport.value)
}

function onSeek(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const pct = (e.clientX - rect.left) / rect.width
  seekTo(Math.max(0, Math.min(1, pct)))
}
</script>

<template>
  <Transition name="floating-player">
    <div v-if="showFloating" class="floating-player" :class="{ collapsed }">

      <!-- ═══ Collapsed: circular play button with progress ring ═══ -->
      <template v-if="collapsed">
        <button class="fp-pill" @click="onToggle">
          <!-- Circular progress ring (SVG) -->
          <svg class="fp-ring" width="52" height="52" viewBox="0 0 52 52">
            <!-- Track -->
            <circle cx="26" cy="26" r="23" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="3" />
            <!-- Progress -->
            <circle
              cx="26" cy="26" r="23" fill="none"
              stroke="#415BFF" stroke-width="3"
              stroke-linecap="round"
              :stroke-dasharray="CIRC"
              :stroke-dashoffset="circOffset"
              transform="rotate(-90 26 26)"
              style="transition: stroke-dashoffset 0.3s linear"
            />
          </svg>
          <!-- Play/pause icon centered -->
          <span class="fp-pill-icon">
            <svg v-if="!isPlaying" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="8,5 20,12 8,19" />
            </svg>
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          </span>
        </button>
      </template>

      <!-- ═══ Expanded: full player bar ═══ -->
      <template v-else>
        <div class="fp-content">
          <!-- Play/pause -->
          <button class="fp-play-btn" @click="onToggle">
            <svg v-if="!isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="8,5 20,12 8,19" />
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          </button>

          <!-- Info + inline progress -->
          <div class="fp-center">
            <div class="fp-info-row">
              <span class="fp-title">{{ currentReport?.entityName || currentReport?.ticker }}</span>
              <span class="fp-time">{{ fmtTime(currentProgress) }} / {{ fmtTime(currentDuration) }}</span>
            </div>
            <div class="fp-progress-bar" @click="onSeek">
              <div class="fp-progress-fill" :style="{ width: progressPct + '%' }"></div>
            </div>
            <span class="fp-subtitle">{{ currentReport?.reportType }} · {{ currentReport?.periodCurrent }}</span>
          </div>

          <!-- Close -->
          <button class="fp-close-btn" @click="stop" title="Cerrar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </template>

    </div>
  </Transition>
</template>

<style scoped>
/* ═══ Base — glass effect matching BottomNavbar ═══ */
.floating-player {
  position: fixed;
  bottom: calc(82px + env(safe-area-inset-bottom, 0px));
  left: 16px;
  right: 16px;
  z-index: 42;
  border-radius: 22px;
  background: rgba(14, 14, 22, 0.65);
  backdrop-filter: blur(24px) saturate(1.5);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 0.5px rgba(255, 255, 255, 0.04) inset;
  overflow: hidden;
  transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              right 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              height 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              border-radius 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              bottom 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Desktop: bottom-right, sized similar to mobile bottom navbar (~calc(100vw - 32px) ≈ 360px) */
@media (min-width: 1024px) {
  .floating-player {
    bottom: 16px;
    left: auto;
    right: 16px;
    width: calc(100vw - 32px);
    max-width: 360px;
  }
}

/* ═══ Collapsed: small circular pill ═══ */
.floating-player.collapsed {
  left: 12px;
  right: auto;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  bottom: calc(70px + env(safe-area-inset-bottom, 0px));
  overflow: visible;
  background: rgba(14, 14, 22, 0.75);
}

.fp-pill {
  position: relative;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

.fp-ring {
  position: absolute;
  inset: 0;
}

.fp-pill-icon {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(65, 91, 255, 0.15);
  color: #415BFF;
  transition: background 0.2s, transform 0.2s;
}
.fp-pill:hover .fp-pill-icon {
  background: rgba(65, 91, 255, 0.25);
  transform: scale(1.05);
}
.fp-pill:active .fp-pill-icon {
  transform: scale(0.95);
}

/* ═══ Expanded bar ═══ */
.fp-content {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}

.fp-play-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(65, 91, 255, 0.12);
  color: #415BFF;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s ease;
}
.fp-play-btn:hover {
  background: rgba(65, 91, 255, 0.22);
  transform: scale(1.05);
}

.fp-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fp-info-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.fp-title {
  font-size: 12px;
  font-weight: 600;
  color: #e4e4e7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fp-subtitle {
  font-size: 10px;
  color: #52525b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fp-time {
  font-size: 10px;
  color: #71717a;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.fp-progress-bar {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.fp-progress-bar:hover { height: 6px; }

.fp-progress-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  border-radius: 2px;
  background: linear-gradient(90deg, #415BFF, #818cf8);
  transition: width 0.25s linear;
}

.fp-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  color: #71717a;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}
.fp-close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #a1a1aa;
}

/* ═══ Enter/leave transitions ═══ */
.floating-player-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.floating-player-leave-active {
  transition: all 0.2s ease-in;
}
.floating-player-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}
.floating-player-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
</style>
