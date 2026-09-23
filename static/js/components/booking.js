// Booking widgets shared by the driver dashboard pages (registered locally by the views that use them).
import { clock } from '../clock.js';
import { money, range, relTime, countdown, duration, dt } from '../format.js';

export const BookingCard = {
  props: { b: { type: Object, required: true } },
  data() { return { clock }; },
  computed: {
    hint() {
      const b = this.b, now = this.clock.now;
      switch (b.status) {
        case 'upcoming': case 'ready': return `Starts ${relTime(b.start_time, now)}`;
        case 'parked': return `Ends ${relTime(b.end_time, now)}`;
        case 'overstay': return `Overstaying · fine so far ${money(b.amounts.fine)}`;
        case 'completed': return b.amounts.fine_status === 'due' ? `Fine due ${money(b.amounts.fine)}` : `Left ${relTime(b.checked_out_at, now)}`;
        case 'cancelled': return b.amounts.refund ? `Refunded ${money(b.amounts.refund)}` : 'Cancelled';
        default: return '';
      }
    },
    cta() {
      const b = this.b;
      if (b.actions.can_pay_fine) return { label: 'Pay fine', q: { action: 'pay-fine' }, cls: 'btn-danger' };
      if (b.status === 'overstay') return { label: 'Check out', q: {}, cls: 'btn-danger' };
      if (b.status === 'ready') return { label: 'Check in', q: {}, cls: '' };
      if (b.status === 'parked') return { label: 'Manage', q: {}, cls: '' };
      return { label: 'Details', q: {}, cls: 'btn-outline' };
    },
  },
  methods: { money, range },
  template: `
  <article :class="['bk', 's-' + b.status, b.status === 'cancelled' ? 'cancelled' : '']">
    <div class="stripe"></div>
    <div class="bk-body">
      <div class="bk-title">
        <h4>{{ b.lot.name }}</h4>
        <status-pill :status="b.status"></status-pill>
        <span v-if="b.actions.can_pay_fine && b.status !== 'overstay'" class="pill bad"><i class="bi bi-cash-coin"></i> Fine due</span>
      </div>
      <div class="bk-meta">
        <span><i class="bi bi-calendar3"></i>{{ range(b.start_time, b.end_time) }}</span>
        <span><i class="bi bi-p-square"></i>Slot {{ b.slot.full_label }}<template v-if="b.slot.type === 'ev'"> · EV</template></span>
        <span><i class="bi bi-car-front"></i>{{ b.vehicle_number }}</span>
        <span class="mono"><i class="bi bi-upc-scan"></i>{{ b.code }}</span>
      </div>
    </div>
    <div class="bk-side">
      <div class="right"><div class="bk-amt">{{ money(b.amounts.total_paid) }}</div><div class="tiny muted">{{ hint }}</div></div>
      <router-link :to="{ path: '/app/bookings/' + b.id, query: cta.q }" :class="['btn btn-sm', cta.cls]">{{ cta.label }}</router-link>
    </div>
  </article>`,
};

// Big "what is happening right now" card (home page).
export const LiveBooking = {
  props: { b: { type: Object, required: true } },
  data() { return { clock }; },
  computed: {
    mode() { return this.b.status === 'overstay' ? 'over' : (this.b.status === 'parked' ? 'parked' : 'soon'); },
    startMs() { return Date.parse(this.b.start_time); },
    endMs() { return Date.parse(this.b.end_time); },
    remaining() {
      if (this.b.status === 'overstay') return this.clock.now - this.endMs;
      if (this.b.status === 'parked') return this.endMs - this.clock.now;
      return this.startMs - this.clock.now;
    },
    label() {
      return { overstay: 'Overstaying by', parked: 'Time left', ready: 'Starts in', upcoming: 'Starts in' }[this.b.status] || '';
    },
    pct() {
      if (this.b.status === 'overstay') return 100;
      if (this.b.status !== 'parked') return 0;
      return Math.max(0, Math.min(100, ((this.clock.now - this.startMs) / Math.max(1, this.endMs - this.startMs)) * 100));
    },
    clockText() {
      const ms = this.remaining;
      if (ms < 0 && this.b.status !== 'overstay') return '00:00';
      return countdown(Math.abs(ms));
    },
  },
  methods: { money, dt },
  template: `
  <div :class="['live-card', mode]">
    <div class="flex between items-start wrap gap-2">
      <div>
        <h3>{{ b.lot.name }}</h3>
        <div class="sub"><i class="bi bi-geo-alt"></i> {{ b.slot.location }}</div>
      </div>
      <span class="slot-badge"><i class="bi bi-p-square-fill"></i>{{ b.slot.full_label }}</span>
    </div>
    <div class="mt-3 tiny" style="opacity:.85;font-weight:800;letter-spacing:.08em;text-transform:uppercase">{{ label }}</div>
    <div class="countdown">{{ clockText }}</div>
    <div class="sub" v-if="b.status === 'overstay'">Fine so far <b>{{ money(b.amounts.fine) }}</b> · {{ money(b.fine_rate_per_block) }} per 15 min</div>
    <div class="sub" v-else-if="b.status === 'parked'">Ends {{ dt(b.end_time) }}</div>
    <div class="sub" v-else>{{ dt(b.start_time) }} → {{ dt(b.end_time) }}</div>
    <div class="progress mt-2" v-if="b.status === 'parked' || b.status === 'overstay'"><i :style="{ width: pct + '%' }"></i></div>
    <div class="flex wrap gap-1 mt-3">
      <router-link :to="'/app/bookings/' + b.id" class="btn btn-sm"><i class="bi bi-map"></i> Slot map & actions</router-link>
      <router-link v-if="b.actions.can_extend" :to="{ path: '/app/bookings/' + b.id, query: { action: 'extend' } }" class="btn btn-sm btn-ghost"><i class="bi bi-plus-circle"></i> Extend</router-link>
    </div>
  </div>`,
};

export const greeting = ms => {
  const h = new Date(ms).getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
