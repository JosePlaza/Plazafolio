<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' }, // 'YYYY-MM-DD'
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const pickerRef = ref(null)
const triggerRef = ref(null)

// Parse initial date
function parseDate(str) {
  if (!str) return new Date()
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const viewDate = ref(parseDate(props.modelValue))
const selectedDate = ref(parseDate(props.modelValue))

watch(() => props.modelValue, (val) => {
  if (val) {
    selectedDate.value = parseDate(val)
    viewDate.value = parseDate(val)
  }
})

const viewYear = computed(() => viewDate.value.getFullYear())
const viewMonth = computed(() => viewDate.value.getMonth())

const monthNames = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const dayNames = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

const displayLabel = computed(() => {
  if (!props.modelValue) return 'Seleccionar fecha'
  const d = parseDate(props.modelValue)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
})

// Build calendar grid
const calendarDays = computed(() => {
  const year = viewYear.value
  const month = viewMonth.value
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  // Monday = 0, Sunday = 6
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6

  const days = []

  // Previous month padding
  const prevMonthLast = new Date(year, month, 0).getDate()
  for (let i = startDow - 1; i >= 0; i--) {
    days.push({ day: prevMonthLast - i, month: month - 1, year, outside: true })
  }

  // Current month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push({ day: d, month, year, outside: false })
  }

  // Next month padding (fill to 42 = 6 rows)
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    days.push({ day: d, month: month + 1, year, outside: true })
  }

  return days
})

function isSelected(cell) {
  return !cell.outside
    && cell.day === selectedDate.value.getDate()
    && cell.month === selectedDate.value.getMonth()
    && cell.year === selectedDate.value.getFullYear()
}

function isToday(cell) {
  const today = new Date()
  return !cell.outside
    && cell.day === today.getDate()
    && cell.month === today.getMonth()
    && cell.year === today.getFullYear()
}

function selectDay(cell) {
  if (cell.outside) {
    // Navigate to that month
    viewDate.value = new Date(cell.year, cell.month, cell.day)
  }
  const d = new Date(cell.year, cell.month, cell.day)
  selectedDate.value = d
  const pad = (n) => String(n).padStart(2, '0')
  emit('update:modelValue', `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
  open.value = false
}

function prevMonth() {
  viewDate.value = new Date(viewYear.value, viewMonth.value - 1, 1)
}
function nextMonth() {
  viewDate.value = new Date(viewYear.value, viewMonth.value + 1, 1)
}

function goToday() {
  const today = new Date()
  viewDate.value = new Date(today.getFullYear(), today.getMonth(), 1)
  selectDay({ day: today.getDate(), month: today.getMonth(), year: today.getFullYear(), outside: false })
}

// Position the dropdown relative to trigger
const dropdownStyle = ref({})

function updatePosition() {
  if (!triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    top: `${rect.bottom + 8}px`,
    left: `${rect.left}px`,
    zIndex: 99999,
  }
}

watch(open, (val) => {
  if (val) {
    updatePosition()
  }
})

// Close on outside click
function onClickOutside(e) {
  if (pickerRef.value && !pickerRef.value.contains(e.target) && triggerRef.value && !triggerRef.value.contains(e.target)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
  <div class="relative">
    <!-- Trigger button -->
    <button
      ref="triggerRef"
      type="button"
      class="w-full flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground outline-none transition-colors text-left"
      :class="open ? 'border-primary/40' : 'hover:border-white/15'"
      @click="open = !open"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-500 shrink-0">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <span class="tabular-nums">{{ displayLabel }}</span>
    </button>

    <!-- Dropdown calendar -->
    <Teleport to="body">
      <Transition name="picker-fade">
        <div
          v-if="open"
          ref="pickerRef"
          class="fixed w-[280px] rounded-xl p-3 datepicker-dropdown"
          :style="dropdownStyle"
        >
        <!-- Header: month/year + nav -->
        <div class="flex items-center justify-between mb-2 px-1">
          <button
            type="button"
            class="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
            @click="prevMonth"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <span class="text-sm font-semibold text-foreground">
            {{ monthNames[viewMonth] }} {{ viewYear }}
          </span>

          <button
            type="button"
            class="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
            @click="nextMonth"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <!-- Day names -->
        <div class="grid grid-cols-7 mb-1">
          <div
            v-for="dn in dayNames"
            :key="dn"
            class="text-center text-[10px] font-medium text-zinc-400 uppercase tracking-wider py-1"
          >
            {{ dn }}
          </div>
        </div>

        <!-- Day grid -->
        <div class="grid grid-cols-7">
          <button
            v-for="(cell, i) in calendarDays"
            :key="i"
            type="button"
            class="h-8 w-full rounded-lg text-xs font-medium transition-all flex items-center justify-center"
            :class="[
              isSelected(cell)
                ? 'bg-primary text-white font-bold'
                : isToday(cell)
                  ? 'text-primary font-bold hover:bg-primary/10'
                  : cell.outside
                    ? 'text-zinc-700 hover:text-zinc-500 hover:bg-white/[0.02]'
                    : 'text-zinc-300 hover:bg-white/5 hover:text-foreground',
            ]"
            @click="selectDay(cell)"
          >
            {{ cell.day }}
          </button>
        </div>

        <!-- Footer -->
        <div class="flex justify-center mt-2 pt-2 border-t border-white/5">
          <button
            type="button"
            class="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors px-3 py-1 rounded-md hover:bg-primary/5"
            @click="goToday"
          >
            Hoy
          </button>
        </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.datepicker-dropdown {
  background: rgba(12, 12, 20, 0.55);
  backdrop-filter: blur(48px) saturate(1.6);
  -webkit-backdrop-filter: blur(48px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 24px 64px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.06) inset,
    0 0 80px rgba(65, 91, 255, 0.08);
}

.picker-fade-enter-active {
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}
.picker-fade-leave-active {
  transition: all 0.1s ease-in;
}
.picker-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
.picker-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px) scale(0.99);
}
</style>
