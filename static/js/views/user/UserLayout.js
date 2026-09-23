// Shell of the DRIVER dashboard: top navigation (bottom tab bar on phones) + live alert banner.
import { get, post } from '../../api.js';
import { session, clearSession } from '../../session.js';
import { money } from '../../format.js';

const LINKS = [
  { to: '/app', icon: 'bi-house-door', label: 'Home', exact: true },
  { to: '/app/find', icon: 'bi-search', label: 'Find parking', also: ['/app/book'] },
  { to: '/app/bookings', icon: 'bi-calendar2-check', label: 'My bookings' },
  // "Book a Ride"/"Request Valet"/"My Rides"/"My Valet Requests" all live behind this one link -
  // see views/user/Mobility.js - so the nav here doesn't grow by four new items.
  { to: '/app/mobility', icon: 'bi-car-front-fill', label: 'Rides & valet' },
  { to: '/app/payments', icon: 'bi-receipt', label: 'Payments' },
  { to: '/app/plans', icon: 'bi-stars', label: 'Plans' },
];

export default {
  data() {
    return { s: session, links: LINKS, menu: false, alerts: { over: null, fine: null, fineTotal: 0 }, timer: null };
  },
  computed: {
    initial() { return ((this.s.user && this.s.user.username) || '?').charAt(0).toUpperCase(); },
  },
  created() {
    this.refresh();
    this.timer = setInterval(this.refresh, 30000);
    this.$root.$on('bookings-changed', this.refresh);
    this.$root.$on('clock-changed', this.refresh);
    document.addEventListener('click', this.outside);
  },
  beforeDestroy() {
    clearInterval(this.timer);
    this.$root.$off('bookings-changed', this.refresh);
    this.$root.$off('clock-changed', this.refresh);
    document.removeEventListener('click', this.outside);
  },
  watch: { '$route.path'() { this.menu = false; } },
  methods: {
    money,
    on(l) {
      const p = this.$route.path;
      if (l.exact) return p === l.to || p === l.to + '/';
      return p === l.to || p.startsWith(l.to + '/') || (l.also || []).some(a => p === a || p.startsWith(a + '/'));
    },
    go(to) { if (this.$route.path !== to) this.$router.push(to); },
    outside(e) { if (this.menu && !(this.$refs.menu && this.$refs.menu.contains(e.target))) this.menu = false; },
    async refresh() {
      try {
        const d = await get('/api/bookings');
        const over = d.bookings.find(b => b.status === 'overstay');
        const fineRows = d.bookings.filter(b => b.amounts.fine_status === 'due' && b.status !== 'overstay');
        this.alerts = { over: over || null, fine: fineRows[0] || null, fineTotal: fineRows.reduce((a, b) => a + b.amounts.fine, 0) };
      } catch (e) { /* the banner is optional - ignore network errors */ }
    },
    async logout() {
      try { await post('/api/logout'); } catch (e) { /* ignore */ }
      clearSession();
      this.$router.push('/');
    },
  },
  template: `
  <div class="u-shell">
    <header class="u-top">
      <div class="u-top-in">
        <brand-logo to="/app"></brand-logo>
        <nav class="u-nav">
          <a v-for="l in links" :key="l.to" :href="l.to" :class="['u-link', { active: on(l) }]" @click.prevent="go(l.to)"><i :class="['bi', l.icon]"></i>{{ l.label }}</a>
        </nav>
        <div class="u-user" ref="menu">
          <button class="u-avatar" @click.stop="menu = !menu" :aria-label="'Account menu for ' + (s.user && s.user.username)">{{ initial }}</button>
          <div class="u-menu" v-if="menu">
            <div class="who"><div class="strong">{{ s.user.username }}</div><div class="tiny muted">{{ s.user.email }}</div></div>
            <a href="/app/profile" @click.prevent="go('/app/profile')"><i class="bi bi-person-circle"></i> My profile</a>
            <a href="/app/payments" @click.prevent="go('/app/payments')"><i class="bi bi-receipt"></i> Payments</a>
            <a href="/app/plans" @click.prevent="go('/app/plans')"><i class="bi bi-stars"></i> Subscription plans</a>
            <a href="/" @click.prevent="go('/')"><i class="bi bi-globe2"></i> Website</a>
            <button class="out" @click="logout"><i class="bi bi-box-arrow-right"></i> Sign out</button>
          </div>
        </div>
      </div>
    </header>

    <div class="u-banner" v-if="alerts.over || alerts.fine">
      <div class="alert bad" v-if="alerts.over">
        <i class="bi bi-exclamation-triangle-fill"></i>
        <div class="grow"><b>You are overstaying at {{ alerts.over.lot.name }} (slot {{ alerts.over.slot.full_label }}).</b>
          {{ alerts.over.overstay_minutes_now }} min over - fine so far {{ money(alerts.over.amounts.fine) }}. The next driver needs this slot.</div>
        <button class="btn btn-sm btn-danger" @click="go('/app/bookings/' + alerts.over.id)">Check out</button>
      </div>
      <div class="alert warn" v-else-if="alerts.fine">
        <i class="bi bi-cash-coin"></i>
        <div class="grow"><b>You have an unpaid overstay fine of {{ money(alerts.fineTotal) }}.</b> New bookings are paused until it is paid.</div>
        <button class="btn btn-sm" @click="go('/app/bookings/' + alerts.fine.id)">Pay fine</button>
      </div>
    </div>

    <main class="u-main"><router-view :key="$route.fullPath"></router-view></main>

    <nav class="u-bottom">
      <a v-for="l in links" :key="l.to" :href="l.to" :class="{ active: on(l) }" @click.prevent="go(l.to)"><i :class="['bi', l.icon]"></i>{{ l.label.split(' ')[0] === 'My' ? 'Bookings' : l.label.split(' ')[0] }}</a>
    </nav>
  </div>`,
};
