<script setup>
import { computed, provide, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useAppState } from '@/composables/useAppState'
import AuthView from '@/components/AuthView.vue'
import AppHeader from '@/components/AppHeader.vue'
import BottomNavbar from '@/components/BottomNavbar.vue'
import FloatingAudioPlayer from '@/components/FloatingAudioPlayer.vue'
import AddAssetModal from '@/components/AddAssetModal.vue'

const { user, loading: authLoading, init: initAuth, signOut } = useAuth()
const app = useAppState()
const route = useRoute()
const router = useRouter()

// Provide shared state to all child views
provide('appState', app)

// Current tab derived from route
const activeTab = computed(() => route.meta?.tab || 'home')

// Navigation helpers
function onTabChange(tab) {
  app.portfolioDetailAsset.value = null
  router.push(`/${tab}`)
}

function onRankingSelect(asset) {
  app.selectedAssetId.value = asset.id
  app.companyLogo.value = asset.image
  app.onGenerate(asset.ticker, app.years.value)
  router.push('/analysis')
}

function openSettings() {
  router.push('/settings')
}

function onSelectAsset(asset) {
  app.onSelectAsset(asset)
  // Navigate to analysis if not already there
  if (route.name !== 'analysis') router.push('/analysis')
}

onMounted(async () => {
  await initAuth()
  app.loadAssets()
})
</script>

<template>
  <!-- Auth loading -->
  <div v-if="authLoading" class="h-dvh flex items-center justify-center bg-background">
    <div class="spinner" style="width: 32px; height: 32px;"></div>
  </div>

  <!-- Login / Register -->
  <AuthView v-else-if="!user" @authenticated="app.loadAssets()" />

  <!-- Authenticated app -->
  <div v-else class="h-screen flex flex-col relative">
    <!-- Background blobs -->
    <div class="bg-blobs">
      <div class="bg-blob-3" />
    </div>

    <!-- Header -->
    <AppHeader
      :active-tab="activeTab"
      :actives="app.actives.value"
      @update:active-tab="onTabChange"
      @sign-out="signOut"
      @open-settings="openSettings"
    />

    <!-- Router view with fade transition -->
    <Transition name="view-fade" mode="out-in">
      <div
        :key="activeTab"
        class="flex flex-1 relative z-10"
        style="padding-top: calc(3.5rem + env(safe-area-inset-top, 0px));"
      >
        <router-view />
      </div>
    </Transition>

    <!-- Floating audio player (persists across views) -->
    <FloatingAudioPlayer />

    <!-- Bottom navbar (mobile only) -->
    <BottomNavbar
      :active-tab="activeTab"
      @update:active-tab="onTabChange"
    />

    <!-- Add Asset Modal -->
    <AddAssetModal
      v-if="app.showAddModal.value"
      @close="app.showAddModal.value = false"
      @add="app.onAddAsset"
    />
  </div>
</template>
