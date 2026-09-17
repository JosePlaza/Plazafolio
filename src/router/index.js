import { createRouter, createWebHashHistory } from 'vue-router'

const HomePage = () => import('@/views/HomePage.vue')
const AnalysisView = () => import('@/views/AnalysisView.vue')
const RankingPage = () => import('@/views/RankingPage.vue')
const PortfolioPage = () => import('@/views/PortfolioPage.vue')
const DividendsPage = () => import('@/views/DividendsPage.vue')
const SettingsView = () => import('@/components/SettingsView.vue')
const SimulatorPage = () => import('@/views/SimulatorPage.vue')

const routes = [
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'home', component: HomePage, meta: { tab: 'home' } },
  { path: '/analysis', name: 'analysis', component: AnalysisView, meta: { tab: 'analysis' } },
  { path: '/ranking', name: 'ranking', component: RankingPage, meta: { tab: 'ranking' } },
  { path: '/portfolio', name: 'portfolio', component: PortfolioPage, meta: { tab: 'portfolio' } },
  { path: '/portfolio/:ticker', name: 'portfolio-detail', component: PortfolioPage, meta: { tab: 'portfolio' } },
  { path: '/dividends', name: 'dividends', component: DividendsPage, meta: { tab: 'dividends' } },
  { path: '/simulator', name: 'simulator', component: SimulatorPage, meta: { tab: 'dividends' } },
  { path: '/settings', name: 'settings', component: SettingsView, meta: { tab: 'settings' } },
  { path: '/:pathMatch(.*)*', redirect: '/home' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
