// Live operations console: every booking across the owner's lots, with front-desk actions.
import { get, post } from '../../api.js';
import { clock } from '../../clock.js';
import { money, moneyExact, dt, timeOnly, relTime } from '../../format.js';

const TABS = [
  { k: 'all', l: 'All' }, { k: 'ready', l: 'Arriving' }, { k: 'upcoming', l: 'Upcoming' }, { k: 'parked', l: 'Parked' },
  { k: 'overstay', l: 'Overstaying' }, { k: 'fine_due', l: 'Fine due' }, { k: 'completed', l: 'Completed' },
  { k: 'cancelled', l: 'Cancelled' }, { k: 'no_show', l: 'No-show' },
];

export default {
  data() {
    return {
      clock, loading: true, error: '', items: [], counts: {}, tabs: TABS, lots: [],
      status: 'all', q: this.$route.query.q || '', lotId: '', limit: 40, timer: null, t: null, ask: null, busy: false, askErr: '',
    };
  },
  created() {
    get('/api/admin/lots').then(d => { this.lots = d.lots; }).catch(() => {});
    this.load();
    this.timer = setInterval(this.load, 20000);
    this.$root.$on('clock-changed', this.load);
  },
  beforeDestroy() { clearInterval(this.timer); this.$root.$off('clock-changed', this.load); },
  watch: {
    status() { this.limit = 40; this.load(); }, lotId() { this.limit = 40; this.load(); },
    q() { clearTimeout(this.t); this.limit = 40; this.t = setTimeout(this.load, 250); },
  },
  computed: { visible() { return this.items.slice(0, this.limit); } },
  methods: {
    money, moneyExact, dt, timeOnly, relTime,
    async load() {
      try {
        const d = await get('/api/admin/bookings', { status: this.status, q: this.q, lot_id: this.lotId });
        this.items = d.bookings; this.counts = d.counts; this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    n(k) { return k === 'all' ? Object.keys(this.counts).filter(x => x !== 'fine_due').reduce((a, x) => a + this.counts[x], 0) : (this.counts[k] || 0); },
    rowClass(b) { return b.status === 'overstay' || b.amounts.fine_status === 'due' ? 'row-bad' : ''; },
    // which front-desk actions make sense for this booking
    actions(b) {
      const a = [];
      if (['upcoming', 'ready'].includes(b.status) && !b.checked_in_at) a.push({ k: 'check-in', l: 'Check in', cls: 'btn-soft', icon: 'bi-box-arrow-in-right' });
      if (['parked', 'overstay'].includes(b.status)) a.push({ k: 'check-out', l: 'Check out', cls: b.status === 'overstay' ? 'btn-danger' : 'btn-outline', icon: 'bi-box-arrow-right' });
      if (b.amounts.fine_status === 'due' && b.status === 'completed') {
        a.push({ k: 'collect-fine', l: 'Collect fine', cls: '', icon: 'bi-cash-coin' });
        a.push({ k: 'waive-fine', l: 'Waive', cls: 'btn-outline', icon: 'bi-hand-thumbs-up' });
      }
      if (['upcoming', 'ready'].includes(b.status) && !b.checked_in_at) a.push({ k: 'cancel', l: 'Cancel', cls: 'btn-danger-outline', icon: 'bi-x-circle' });
      return a;
    },
    confirm(b, a) {
      const text = {
        'check-in': `Mark ${b.vehicle_number} as arrived at ${b.slot.full_label}?`,
        'check-out': b.status === 'overstay'
          ? `${b.vehicle_number} is ${b.overstay_minutes_now} min over its time. Checking out records a fine of ${money(b.amounts.fine)} (due).`
          : `Mark ${b.vehicle_number} as departed? The slot then rests for ${b.buffer_minutes} min before the next booking.`,
        'collect-fine': `Record ${money(b.amounts.fine)} fine as collected in cash/at the counter from ${b.user.username}?`,
        'waive-fine': `Waive the ${money(b.amounts.fine)} fine for ${b.user.username}? They will be able to book again.`,
        cancel: `Cancel booking ${b.code} for ${b.user.username}? They receive a full refund.`,
      }[a.k];
      this.ask = { b, a, text }; this.askErr = '';
    },
    async run() {
      this.busy = true; this.askErr = '';
      try {
        await post(`/api/admin/bookings/${this.ask.b.id}/${this.ask.a.k}`);
        this.$toast.success(this.ask.a.l + ' - done');
        this.ask = null;
        await this.load();
        this.$root.$emit('admin-changed');
      } catch (e) { this.askErr = e.message; }
      this.busy = false;
    },
  },
  template: `
  <div>
    <div class="a-head"><div><h1>Live operations</h1><p>Front-desk view of every booking. Refreshes every 20 seconds.</p></div>
      <button class="btn btn-outline btn-sm" @click="load"><i class="bi bi-arrow-repeat"></i> Refresh</button></div>

    <div class="pill-tabs mb-2"><button v-for="t in tabs" :key="t.k" v-show="t.k === 'all' || n(t.k) > 0 || status === t.k" :class="['ptab', { active: status === t.k }]" @click="status = t.k">{{ t.l }}<span class="n">{{ n(t.k) }}</span></button></div>
    <div class="toolbar">
      <div class="search"><i class="bi bi-search"></i><input class="input" v-model="q" placeholder="Search code, vehicle, driver, slot…" aria-label="Search bookings"></div>
      <select class="select" v-model="lotId" aria-label="Filter by lot"><option value="">All lots</option><option v-for="l in lots" :key="l.id" :value="l.id">{{ l.name }}</option></select>
    </div>

    <div v-if="error" class="alert bad"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="skeleton" style="height:320px"></div>
    <div class="a-card" v-else>
      <div class="a-table-wrap" v-if="items.length">
        <table class="dt">
          <thead><tr><th>Booking</th><th>Driver</th><th>Lot · Slot</th><th>Time</th><th>Status</th><th class="num">Paid / fine</th><th></th></tr></thead>
          <tbody>
            <tr v-for="b in visible" :key="b.id" :class="rowClass(b)">
              <td><span class="mono">{{ b.code }}</span><div class="mono tiny muted">{{ b.vehicle_number }}</div></td>
              <td class="nw" :title="b.user.email">{{ b.user.username }}<div class="tiny muted">{{ b.user.phone || b.user.email }}</div></td>
              <td class="nw">{{ b.lot.name }}<div><b>{{ b.slot.full_label }}</b> <span class="tiny muted">{{ b.slot.type === 'ev' ? 'EV bay' : '' }}</span></div></td>
              <td class="nw">{{ dt(b.start_time) }}<div class="tiny muted">until {{ timeOnly(b.end_time) }} · {{ b.status === 'parked' || b.status === 'overstay' ? (b.status === 'overstay' ? b.overstay_minutes_now + ' min over' : relTime(b.end_time, clock.now)) : relTime(b.start_time, clock.now) }}</div></td>
              <td><status-pill :status="b.status"></status-pill></td>
              <td class="num nw">{{ moneyExact(b.amounts.total_paid) }}<div v-if="b.amounts.fine > 0" :class="['tiny', b.amounts.fine_status === 'due' || b.status === 'overstay' ? 'bad-text strong' : 'muted']">fine {{ moneyExact(b.amounts.fine) }} · {{ b.amounts.fine_is_live ? 'accruing' : b.amounts.fine_status }}</div></td>
              <td><div class="dt-actions"><button v-for="a in actions(b)" :key="a.k" :class="['btn btn-xs', a.cls]" @click="confirm(b, a)"><i :class="['bi', a.icon]"></i> {{ a.l }}</button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <empty-state v-else icon="bi-inbox" title="No bookings match" text="Try another status or search term."></empty-state>
      <div v-if="items.length > limit" class="right" style="padding:12px 16px;border-top:1px solid #edf0f7"><span class="small muted" style="margin-right:12px">Showing {{ limit }} of {{ items.length }}</span><button class="btn btn-sm btn-outline" @click="limit += 60">Show more</button></div>
    </div>

    <modal v-if="ask" :title="ask.a.l + ' · ' + ask.b.code" @close="ask = null">
      <p>{{ ask.text }}</p>
      <div v-if="askErr" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ askErr }}</div></div>
      <template slot="footer"><button class="btn btn-outline" @click="ask = null">Back</button>
        <button :class="['btn', ['cancel', 'check-out'].includes(ask.a.k) && ask.b.status === 'overstay' ? 'btn-danger' : '']" :disabled="busy" @click="run"><span v-if="busy" class="spin"></span>{{ ask.a.l }}</button></template>
    </modal>
  </div>`,
};
