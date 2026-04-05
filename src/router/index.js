import { createRouter, createWebHashHistory } from 'vue-router'

const AnalysisView = () => import('@/views/AnalysisView.vue')
const RankingPage = () => import('@/views/RankingPage.vue')
const PortfolioPage = () => import('@/views/PortfolioPage.vue')
const DividendsPage = () => import('@/views/DividendsPage.vue')
const SettingsView = () => import('@/components/SettingsView.vue')

const routes = [
  { path: '/', redirect: '/analysis' },
  { path: '/analysis', name: 'analysis', component: AnalysisView, meta: { tab: 'analysis' } },
  { path: '/ranking', name: 'ranking', component: RankingPage, meta: { tab: 'ranking' } },
  { path: '/portfolio', name: 'portfolio', component: PortfolioPage, meta: { tab: 'portfolio' } },
  { path: '/portfolio/:ticker', name: 'portfolio-detail', component: PortfolioPage, meta: { tab: 'portfolio' } },
  { path: '/dividends', name: 'dividends', component: DividendsPage, meta: { tab: 'dividends' } },
  { path: '/settings', name: 'settings', component: SettingsView, meta: { tab: 'settings' } },
  { path: '/:pathMatch(.*)*', redirect: '/analysis' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
