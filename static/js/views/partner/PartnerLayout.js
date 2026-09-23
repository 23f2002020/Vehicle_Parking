// Shell of the DRIVER PARTNER app: dark sidebar (bottom tab bar on phones) + the online/offline
// switch. Entirely separate from UserLayout.js and AdminLayout.js - nothing there was touched.
import { get, post } from '../../api.js';
import { session, clearSession } from '../../session.js';
import { partnerStore, refreshDriver, offlineReason, DRIVER_TYPE_LABEL } from './partnerLib.js';

export default {
  data() {
    return { s: session, store: partnerStore, open: false, toggling: false, err: '', badges: { pool: 0, unread: 0 }, timer: null };
  },
  computed: {
    driver() { return this.store.driver; },
    isCaptain() { return this.driver && this.driver.driver_type === 'ride_captain'; },
    typeLabel() { return this.driver ? DRIVER_TYPE_LABEL[this.driver.driver_type] : ''; },
    avail() { return this.driver ? this.driver.availability : 'OFFLINE'; },
    offlineReason() { return offlineReason(this.driver); },
    title() { return this.$route.meta.title || 'Dashboard'; },
    nav() {
      const jobsLabel = this.isCaptain ? 'Rides' : 'Valet jobs';
      const items = [
        { title: 'Work' },
        { to: '/partner', icon: 'bi-speedometer2', label: 'Dashboard', exact: true },
        { to: '/partner/jobs', icon: 'bi-broadcast', label: jobsLabel, badge: 'pool' },
      ];
      if (this.isCaptain) items.push({ to: '/partner/vehicle', icon: 'bi-car-front', label: 'My vehicle' });
      items.push(
        { title: 'Account' },
        { to: '/partner/kyc', icon: 'bi-patch-check', label: 'Verification' },
        { to: '/partner/earnings', icon: 'bi-wallet2', label: 'Earnings' },
        { to: '/partner/ratings', icon: 'bi-star', label: 'Ratings' },
        { to: '/partner/notifications', icon: 'bi-bell', label: 'Notifications', badge: 'unread' },
        { to: '/partner/profile', icon: 'bi-person-gear', label: 'My profile' },
      );
      return items;
    },
    bottomLinks() {
      return [
        { to: '/partner', icon: 'bi-speedometer2', label: 'Home', exact: true },
        { to: '/partner/jobs', icon: 'bi-broadcast', label: this.isCaptain ? 'Rides' : 'Valet' },
        { to: '/partner/earnings', icon: 'bi-wallet2', label: 'Earnings' },
        { to: '/partner/notifications', icon: 'bi-bell', label: 'Alerts' },
        { to: '/partner/profile', icon: 'bi-person', label: 'Profile' },
      ];
    },
  },
  created() {
    this.refresh();
    this.timer = setInterval(this.refresh, 30000);
    this.$root.$on('partner-changed', this.refresh);
  },
  beforeDestroy() {
    clearInterval(this.timer);
    this.$root.$off('partner-changed', this.refresh);
  },
  watch: { '$route.path'() { this.open = false; } },
  methods: {
    on(l) {
      const p = this.$route.path;
      if (l.exact) return p === l.to || p === l.to + '/';
      return p === l.to || p.startsWith(l.to + '/');
    },
    go(to) { if (this.$route.path !== to) this.$router.push(to); },
    async refresh() {
      try {
        await refreshDriver();
        const [pool, notifs] = await Promise.all([
          get(this.isCaptain ? '/api/driver/rides' : '/api/driver/valet', { scope: 'available' }),
          get('/api/driver/notifications', { unread: '1' }),
        ]);
        const poolList = this.isCaptain ? pool.rides : pool.valet_requests;
        this.badges = { pool: (poolList || []).length, unread: notifs.notifications.length };
        this.err = '';
      } catch (e) { this.err = e.message; }
    },
    async toggle(e) {
      const wantOnline = e.target.checked;
      this.toggling = true;
      try {
        const r = await post('/api/driver/availability', { status: wantOnline ? 'AVAILABLE' : 'OFFLINE' });
        this.$toast.success(r.message);
        await this.refresh();
      } catch (err) {
        e.target.checked = !wantOnline;
        this.$toast.error(err.message);
      }
      this.toggling = false;
    },
    async logout() {
      try { await post('/api/logout'); } catch (e) { /* ignore */ }
      clearSession();
      this.$router.push('/');
    },
  },
  template: `
  <div :class="['p-shell', { open }]">
    <aside class="p-side">
      <div class="p-brand"><brand-logo to="/partner" light></brand-logo></div>
      <span class="p-role" v-if="driver">{{ typeLabel }} partner</span>

      <div class="p-online" v-if="driver">
        <div class="row">
          <span :class="['st', avail === 'BUSY' ? 'busy' : (avail === 'AVAILABLE' ? 'on' : '')]">
            <span class="dot"></span>{{ avail === 'BUSY' ? 'On a job' : (avail === 'AVAILABLE' ? (isCaptain ? 'Online' : 'Available') : 'Offline') }}
          </span>
          <label class="p-switch">
            <input type="checkbox" :checked="avail === 'AVAILABLE' || avail === 'BUSY'" :disabled="avail === 'BUSY' || toggling" @change="toggle">
            <span class="track"></span>
          </label>
        </div>
        <div class="why" v-if="avail === 'OFFLINE' && offlineReason">{{ offlineReason }}</div>
      </div>

      <nav>
        <template v-for="(l, i) in nav">
          <div v-if="l.title" :key="'t' + i" class="p-nav-title">{{ l.title }}</div>
          <a v-else :key="l.to" :href="l.to" :class="['p-link', { active: on(l) }]" @click.prevent="go(l.to)">
            <i :class="['bi', l.icon]"></i>{{ l.label }}
            <span v-if="l.badge && badges[l.badge]" class="badge">{{ badges[l.badge] }}</span>
          </a>
        </template>
      </nav>
      <div class="p-side-foot">
        <div class="who">{{ driver ? driver.full_name : (s.user && s.user.username) }}</div>
        <div class="tiny" style="color:#9d97c9">{{ s.user && s.user.email }}</div>
        <button @click="logout"><i class="bi bi-box-arrow-right"></i> Sign out</button>
      </div>
    </aside>
    <div class="p-backdrop" @click="open = false"></div>
    <div class="p-main">
      <header class="p-top">
        <button class="icon-btn p-burger" @click="open = !open" aria-label="Menu"><i class="bi bi-list"></i></button>
        <span class="crumb">Partner /</span><h2>{{ title }}</h2>
        <span class="grow"></span>
        <a href="/" class="small strong" @click.prevent="go('/')"><i class="bi bi-globe2"></i> Website</a>
      </header>
      <main class="p-content"><router-view :key="$route.fullPath"></router-view></main>
    </div>
    <nav class="p-bottom">
      <a v-for="l in bottomLinks" :key="l.to" :href="l.to" :class="{ active: on(l) }" @click.prevent="go(l.to)"><i :class="['bi', l.icon]"></i>{{ l.label }}</a>
    </nav>
  </div>`,
};
