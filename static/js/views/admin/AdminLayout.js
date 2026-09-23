// Shell of the LOT-OWNER console: dark sidebar navigation + top bar. Completely separate from the driver app.
import { get, post } from '../../api.js';
import { session, clearSession } from '../../session.js';

const NAV = [
  { title: 'Monitor' },
  { to: '/admin', icon: 'bi-speedometer2', label: 'Overview', exact: true },
  { to: '/admin/operations', icon: 'bi-activity', label: 'Live operations', badge: 'over' },
  { to: '/admin/reports', icon: 'bi-graph-up-arrow', label: 'Reports' },
  { title: 'Manage' },
  { to: '/admin/lots', icon: 'bi-buildings', label: 'Parking lots' },
  { to: '/admin/users', icon: 'bi-people', label: 'Drivers' },
  { title: 'Money' },
  { to: '/admin/transactions', icon: 'bi-cash-stack', label: 'Transactions', badge: 'fines' },
  { to: '/admin/plans', icon: 'bi-stars', label: 'Plans & billing' },
  // "Driver partners" = ride captains / valet drivers - deliberately worded differently from the
  // "Drivers" item above (parking customers), see driver_service.py's module docstring.
  { title: 'Driver partners' },
  { to: '/admin/driver-partners', icon: 'bi-person-badge', label: 'Driver partners' },
  { to: '/admin/rides-valet', icon: 'bi-broadcast', label: 'Rides & valet jobs' },
  { to: '/admin/driver-revenue', icon: 'bi-graph-up', label: 'Partner revenue' },
  { title: 'Platform' },
  { to: '/admin/system', icon: 'bi-hdd-network', label: 'System & jobs' },
  { to: '/admin/profile', icon: 'bi-person-gear', label: 'My profile' },
];

export default {
  data() { return { s: session, nav: NAV, open: false, badges: { over: 0, fines: 0 }, timer: null }; },
  computed: {
    title() { return this.$route.meta.title || 'Console'; },
  },
  created() {
    this.refresh();
    this.timer = setInterval(this.refresh, 45000);
    this.$root.$on('admin-changed', this.refresh);
    this.$root.$on('clock-changed', this.refresh);
  },
  beforeDestroy() {
    clearInterval(this.timer);
    this.$root.$off('admin-changed', this.refresh);
    this.$root.$off('clock-changed', this.refresh);
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
        const d = await get('/api/admin/bookings', { status: 'overstay' });
        this.badges = { over: d.counts.overstay || 0, fines: d.counts.fine_due || 0 };
      } catch (e) { /* non-critical */ }
    },
    async logout() {
      try { await post('/api/logout'); } catch (e) { /* ignore */ }
      clearSession();
      this.$router.push('/');
    },
  },
  template: `
  <div :class="['a-shell', { open }]">
    <aside class="a-side">
      <div class="a-brand"><brand-logo to="/admin" light></brand-logo></div>
      <span class="a-role">Lot owner console</span>
      <nav>
        <template v-for="(l, i) in nav">
          <div v-if="l.title" :key="'t' + i" class="a-nav-title">{{ l.title }}</div>
          <a v-else :key="l.to" :href="l.to" :class="['a-link', { active: on(l) }]" @click.prevent="go(l.to)">
            <i :class="['bi', l.icon]"></i>{{ l.label }}
            <span v-if="l.badge && badges[l.badge]" :class="['badge', l.badge === 'fines' ? 'amber' : '']">{{ badges[l.badge] }}</span>
          </a>
        </template>
      </nav>
      <div class="a-side-foot">
        <div class="who">{{ s.user && s.user.username }}</div><div class="tiny" style="color:#8c94c0">{{ s.user && s.user.email }}</div>
        <button @click="logout"><i class="bi bi-box-arrow-right"></i> Sign out</button>
      </div>
    </aside>
    <div class="a-backdrop" @click="open = false"></div>
    <div class="a-main">
      <header class="a-top">
        <button class="icon-btn a-burger" @click="open = !open" aria-label="Menu"><i class="bi bi-list"></i></button>
        <span class="crumb">Console /</span><h2>{{ title }}</h2>
        <span class="grow"></span>
        <a href="/" class="small strong" @click.prevent="go('/')"><i class="bi bi-globe2"></i> Website</a>
      </header>
      <main class="a-content"><router-view :key="$route.fullPath"></router-view></main>
    </div>
  </div>`,
};
