// Small shared components, registered globally by registerUi().
import { statusMeta, money } from '../format.js';

// ------------------------------------------------------------------ toasts
export const toastState = Vue.observable({ items: [], seq: 0 });
function pushToast(type, message) {
  const id = ++toastState.seq;
  toastState.items.push({ id, type, message });
  setTimeout(() => { toastState.items = toastState.items.filter(t => t.id !== id); }, type === 'error' ? 6500 : 3800);
}
export const toast = { success: m => pushToast('success', m), error: m => pushToast('error', m), info: m => pushToast('info', m) };

const ToastHost = {
  template: `
  <div class="toasts" aria-live="polite">
    <div v-for="t in state.items" :key="t.id" :class="['toast', t.type]">
      <i :class="['bi', t.type === 'error' ? 'bi-exclamation-octagon-fill' : t.type === 'success' ? 'bi-check-circle-fill' : 'bi-info-circle-fill']"></i>
      <span>{{ t.message }}</span>
    </div>
  </div>`,
  data() { return { state: toastState }; },
};

// ------------------------------------------------------------------ modal
const Modal = {
  props: { title: String, size: { type: String, default: '' }, closable: { type: Boolean, default: true } },
  template: `
  <div class="modal-backdrop" @mousedown.self="close">
    <div :class="['modal', size]" role="dialog" aria-modal="true" :aria-label="title">
      <div class="modal-head">
        <h3>{{ title }}</h3>
        <button v-if="closable" class="icon-btn" @click="close" aria-label="Close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="modal-body"><slot></slot></div>
      <div v-if="$slots.footer" class="modal-foot"><slot name="footer"></slot></div>
    </div>
  </div>`,
  methods: {
    close() { if (this.closable) this.$emit('close'); },
    onKey(e) { if (e.key === 'Escape') this.close(); },
  },
  mounted() { document.addEventListener('keydown', this.onKey); document.body.style.overflow = 'hidden'; },
  beforeDestroy() { document.removeEventListener('keydown', this.onKey); document.body.style.overflow = ''; },
};

// ------------------------------------------------------------------ small display components
const StatusPill = {
  props: { status: String },
  computed: { meta() { return statusMeta(this.status); } },
  template: `<span :class="['pill', meta.cls]"><i :class="['bi', meta.icon]"></i>{{ meta.label }}</span>`,
};

const Empty = {
  props: { icon: { type: String, default: 'bi-inbox' }, title: String, text: String },
  template: `<div class="empty"><i :class="['bi', icon]"></i><h4>{{ title }}</h4><p v-if="text">{{ text }}</p><slot></slot></div>`,
};

const Spinner = { template: `<div class="spinner" role="status" aria-label="Loading"></div>` };

const Logo = {
  props: { to: { type: String, default: '/' }, light: Boolean },
  template: `<router-link :to="to" class="logo"><img src="/static/img/logo-mark.png" alt=""><span><b :style="light ? 'color:#fff' : ''">VPark</b><em>Easy</em></span></router-link>`,
};

const AmenityChips = {
  props: { amenities: { type: Array, default: () => [] }, limit: { type: Number, default: 99 }, showPrice: Boolean },
  computed: {
    shown() { return this.amenities.slice(0, this.limit); },
    extra() { return Math.max(0, this.amenities.length - this.limit); },
  },
  methods: { money },
  template: `
  <div class="amenity-row">
    <span v-for="a in shown" :key="a.code" :class="['amenity', a.category === 'bookable' ? '' : 'onsite']" :title="a.description">
      <i :class="['bi', a.icon]"></i>{{ a.name }}<template v-if="showPrice && a.category === 'bookable'"> · {{ money(a.price) }}</template>
    </span>
    <span v-if="extra" class="amenity onsite">+{{ extra }} more</span>
  </div>`,
};

const PriceBreakdown = {
  props: { quote: Object, totalLabel: { type: String, default: 'Total to pay' } },
  methods: { money },
  template: `
  <div class="pricebox" v-if="quote">
    <div v-for="(li, i) in quote.line_items" :key="i" :class="['price-line', li.kind === 'discount' ? 'discount' : '']">
      <span>{{ li.label }}</span><span>{{ li.amount < 0 ? '−' : '' }}{{ money(Math.abs(li.amount)) }}</span>
    </div>
    <div class="price-line total"><span>{{ totalLabel }}</span><span>{{ money(quote.total) }}</span></div>
  </div>`,
};

// ------------------------------------------------------------------ payment form (card / UPI)
const TEST_CARDS = { ok: '4111 1111 1111 1111', fail: '4000 0000 0000 0002' };
const PaymentForm = {
  props: { amount: Number, disabled: Boolean },
  data() { return { method: 'card', card: '', exp: '', cvv: '', name: '', upi: '', touched: false }; },
  computed: {
    digits() { return this.card.replace(/\D/g, ''); },
    cardOk() {
      const d = this.digits; if (d.length < 13 || d.length > 19) return false;
      let s = 0, alt = false;
      for (let i = d.length - 1; i >= 0; i--) { let x = +d[i]; if (alt) { x *= 2; if (x > 9) x -= 9; } s += x; alt = !alt; }
      return s % 10 === 0;
    },
    expOk() {
      const m = /^(\d{2})\/(\d{2})$/.exec(this.exp); if (!m) return false;
      const mo = +m[1], yr = 2000 + +m[2], now = new Date();
      return mo >= 1 && mo <= 12 && (yr > now.getFullYear() || (yr === now.getFullYear() && mo >= now.getMonth() + 1));
    },
    cvvOk() { return /^\d{3,4}$/.test(this.cvv); },
    upiOk() { return /^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$/.test(this.upi.trim()); },
    valid() { return this.method === 'card' ? (this.cardOk && this.expOk && this.cvvOk) : this.upiOk; },
    payload() {
      return this.method === 'card'
        ? { method: 'card', card_number: this.digits, expiry: this.exp, cvv: this.cvv, name: this.name }
        : { method: 'upi', upi_id: this.upi.trim() };
    },
  },
  watch: {
    payload: { handler() { this.emit(); }, deep: true },
    valid() { this.emit(); },
  },
  created() { this.emit(); },
  methods: {
    emit() { this.$emit('change', { payload: this.payload, valid: this.valid }); },
    onCard(e) {
      const d = e.target.value.replace(/\D/g, '').slice(0, 19);
      this.card = d.replace(/(.{4})/g, '$1 ').trim();
    },
    onExp(e) {
      let d = e.target.value.replace(/\D/g, '').slice(0, 4);
      if (d.length >= 3) d = d.slice(0, 2) + '/' + d.slice(2);
      this.exp = d;
    },
    fill(kind) { this.method = 'card'; this.card = TEST_CARDS[kind]; this.exp = '12/30'; this.cvv = '123'; this.name = this.name || 'Test Driver'; },
    fillUpi(ok) { this.method = 'upi'; this.upi = ok ? 'demo@upi' : 'fail@upi'; },
  },
  template: `
  <div class="stack">
    <div class="seg">
      <button type="button" :class="{ active: method === 'card' }" @click="method = 'card'"><i class="bi bi-credit-card-2-front"></i> Card</button>
      <button type="button" :class="{ active: method === 'upi' }" @click="method = 'upi'"><i class="bi bi-phone"></i> UPI</button>
    </div>

    <div v-if="method === 'card'">
      <div class="field"><label>Card number</label>
        <input class="input mono" inputmode="numeric" autocomplete="cc-number" placeholder="4111 1111 1111 1111" :value="card" @input="onCard" :class="{ invalid: card && !cardOk && digits.length >= 13 }">
        <div v-if="card && digits.length >= 13 && !cardOk" class="error-text">That card number doesn't look right.</div>
      </div>
      <div class="grid grid-2" style="gap:12px">
        <div class="field"><label>Expiry (MM/YY)</label><input class="input mono" inputmode="numeric" placeholder="12/30" autocomplete="cc-exp" :value="exp" @input="onExp" :class="{ invalid: exp.length === 5 && !expOk }"></div>
        <div class="field"><label>CVV</label><input class="input mono" inputmode="numeric" maxlength="4" placeholder="123" autocomplete="cc-csc" v-model="cvv"></div>
      </div>
      <div class="field"><label>Name on card</label><input class="input" autocomplete="cc-name" placeholder="As printed on the card" v-model="name"></div>
    </div>
    <div v-else>
      <div class="field"><label>UPI ID</label><input class="input" placeholder="yourname@bank" autocomplete="off" v-model="upi" :class="{ invalid: upi && !upiOk }">
        <div v-if="upi && !upiOk" class="error-text">Enter a valid UPI ID, like name@bank.</div></div>
    </div>

    <div class="alert info small">
      <i class="bi bi-shield-lock"></i>
      <div><strong>Demo payment gateway</strong> — no real money moves.
        <div class="mt-1">Try:
          <a href="#" @click.prevent="fill('ok')">success card</a> ·
          <a href="#" @click.prevent="fill('fail')">declined card</a> ·
          <a href="#" @click.prevent="fillUpi(true)">success UPI</a> ·
          <a href="#" @click.prevent="fillUpi(false)">declined UPI</a></div>
      </div>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ SLOT MAP
const STATUS_ICON = { booked: 'bi-car-front-fill', occupied: 'bi-car-front-fill', reserved: 'bi-bookmark-fill', buffer: 'bi-hourglass-split', blocked: 'bi-slash-circle', mine: 'bi-person-fill' };
const SlotMap = {
  props: {
    floors: { type: Array, default: () => [] },
    selectedId: Number,
    highlightId: Number,                  // "your slot" beacon
    interactive: { type: Boolean, default: true },
    admin: Boolean,                       // admin legend (occupied / reserved)
    buffer: { type: Number, default: 45 },
    initialFloor: Number,
  },
  data() { return { floorNo: null }; },
  computed: {
    activeFloor() { return this.floors.find(f => f.floor === this.floorNo) || this.floors[0]; },
    rowsData() {
      const f = this.activeFloor; if (!f) return [];
      const rows = [];
      for (let r = 0; r < f.rows; r++) rows.push({ r, name: String.fromCharCode(65 + r), slots: f.slots.filter(s => s.row === r).sort((a, b) => a.col - b.col) });
      return rows;
    },
    // rows come in facing pairs (A+B, C+D ...) with a driving lane between the pairs
    pairs() {
      const out = [], rows = this.rowsData;
      for (let i = 0; i < rows.length; i += 2) out.push(rows.slice(i, i + 2));
      return out;
    },
  },
  watch: {
    floors: { immediate: true, handler() { this.pickFloor(); } },
    selectedId() { this.pickFloor(); },
    highlightId() { this.pickFloor(); },
  },
  methods: {
    pickFloor() {
      const want = this.highlightId || this.selectedId;
      if (want) { const f = this.floors.find(fl => fl.slots.some(s => s.id === want)); if (f) { this.floorNo = f.floor; return; } }
      if (this.floorNo == null || !this.floors.find(f => f.floor === this.floorNo)) {
        this.floorNo = (this.initialFloor && this.floors.find(f => f.floor === this.initialFloor)) ? this.initialFloor : (this.floors[0] && this.floors[0].floor);
      }
    },
    freeCount(f) { return f.slots.filter(s => s.status === 'available').length; },
    cls(s) {
      const c = ['slot', s.status, 'type-' + s.type];
      if (s.mine && s.status === 'booked') c.push('mine');
      if (s.id === this.selectedId) c.push('selected');
      if (s.id === this.highlightId) c.push('highlight');
      return c;
    },
    icon(s) { return s.mine && s.status === 'booked' ? STATUS_ICON.mine : STATUS_ICON[s.status] || ''; },
    tip(s) {
      const t = { available: 'Available', booked: s.mine ? 'Your booking' : 'Booked for this time', buffer: `Turnaround gap (${this.buffer} min between bookings)`, blocked: 'Closed for maintenance', occupied: 'Occupied now', reserved: 'Reserved' }[s.status] || s.status;
      const type = s.type === 'ev' ? ' · EV charging bay' : s.type === 'accessible' ? ' · Accessible bay' : '';
      let out = `${s.label} · ${t}${type}`;
      if (s.occupant) out += ` · ${s.occupant.vehicle}`;
      if (s.free_from && (s.status === 'booked' || s.status === 'buffer')) out += ` · free again from ${new Date(s.free_from).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      return out;
    },
    click(s) { if (this.interactive) this.$emit('select', s); },
  },
  template: `
  <div class="slotmap">
    <div class="slotmap-head">
      <div class="floor-tabs">
        <button v-for="f in floors" :key="f.floor" :class="['floor-tab', { active: activeFloor && f.floor === activeFloor.floor }]" @click="floorNo = f.floor">
          {{ f.name }}<small v-if="!admin">{{ freeCount(f) }} free</small>
        </button>
      </div>
      <slot name="head"></slot>
    </div>

    <div class="lot-plan" v-if="activeFloor">
      <div class="lot-plan-inner">
        <div class="plan-frame">
          <span class="lift" title="Lift & stairs"><i class="bi bi-arrow-down-up"></i></span>
          <template v-for="(pair, pi) in pairs">
            <div v-if="pi > 0" class="lane" :key="'l' + pi"><span>← drive lane →</span></div>
            <div class="bay-pair" :key="'p' + pi">
              <div v-for="row in pair" :key="row.r" class="bay-line">
                <span class="rowlabel" style="left:-34px">{{ row.name }}</span>
                <button v-for="s in row.slots" :key="s.id" type="button" :class="cls(s)" :title="tip(s)"
                        @click="click(s)" :aria-label="tip(s)">
                  <span class="sn">{{ s.label }}</span>
                  <i v-if="icon(s)" :class="['bi st', icon(s)]"></i>
                </button>
              </div>
            </div>
          </template>
        </div>
        <div class="plan-gates">
          <span class="gate"><i class="bi bi-box-arrow-in-right"></i> Entry</span>
          <span class="muted">Row A is nearest the entry</span>
          <span class="gate">Exit <i class="bi bi-box-arrow-right"></i></span>
        </div>
      </div>
    </div>

    <div class="legend">
      <template v-if="admin">
        <span><i class="l-available"></i>Free</span><span><i class="l-occupied"></i>Occupied</span><span><i class="l-reserved"></i>Reserved</span>
        <span><i class="l-buffer"></i>Turnaround gap</span><span><i class="l-blocked"></i>Closed</span>
      </template>
      <template v-else>
        <span><i class="l-available"></i>Available</span><span><i class="l-booked"></i>Booked</span>
        <span><i class="l-buffer"></i>Turnaround gap ({{ buffer }} min)</span><span><i class="l-blocked"></i>Closed</span>
        <span v-if="selectedId"><i class="l-selected"></i>Your pick</span>
      </template>
      <span><i class="bi bi-lightning-charge-fill ok-text" style="border:0;width:auto"></i>EV bay</span>
    </div>
  </div>`,
};

// ------------------------------------------------------------------ demo clock (time travel)
import { api } from '../api.js';
import { session } from '../session.js';
import { clock } from '../clock.js';
const DemoClock = {
  data() { return { open: false, busy: false, offset: 0, s: session }; },
  computed: { now() { return new Date(clock.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' }); } },
  async created() { try { const t = await api('/api/time', { auth: false }); this.offset = t.clock_offset_minutes; } catch (e) { /* ignore */ } },
  methods: {
    async jump(minutes, reset) {
      this.busy = true;
      try {
        const r = await api('/api/demo/clock', { method: 'POST', body: reset ? { reset: true } : { minutes } });
        this.offset = r.clock_offset_minutes;
        toast.success(reset ? 'Clock reset to real time' : `Jumped forward ${minutes >= 60 ? (minutes / 60) + ' h' : minutes + ' min'}`);
        this.$root.$emit('clock-changed');
      } catch (e) { toast.error(e.message); }
      this.busy = false;
    },
  },
  template: `
  <div class="demo-clock" :class="{ open }">
    <button class="demo-toggle" @click="open = !open" :title="'Demo clock: ' + now"><i class="bi bi-stopwatch"></i><span v-if="offset" class="demo-off">+{{ offset >= 60 ? Math.floor(offset/60) + 'h' + (offset % 60 ? ' ' + offset % 60 + 'm' : '') : offset + 'm' }}</span></button>
    <div v-if="open" class="demo-panel">
      <div class="strong small">Demo time machine</div>
      <div class="tiny muted mb-2">Skip ahead to see extensions, overstay fines and the turnaround buffer without waiting.</div>
      <div class="demo-now">{{ now }}</div>
      <div class="flex wrap gap-1 mt-2">
        <button class="btn btn-sm btn-outline" :disabled="busy" @click="jump(15)">+15 min</button>
        <button class="btn btn-sm btn-outline" :disabled="busy" @click="jump(30)">+30 min</button>
        <button class="btn btn-sm btn-outline" :disabled="busy" @click="jump(60)">+1 h</button>
        <button class="btn btn-sm btn-outline" :disabled="busy" @click="jump(180)">+3 h</button>
        <button class="btn btn-sm btn-ghost" :disabled="busy" @click="jump(0, true)">Reset</button>
      </div>
    </div>
  </div>`,
};

export function registerUi() {
  Vue.component('modal', Modal);
  Vue.component('toast-host', ToastHost);
  Vue.component('status-pill', StatusPill);
  Vue.component('empty-state', Empty);
  Vue.component('spinner', Spinner);
  Vue.component('brand-logo', Logo);
  Vue.component('amenity-chips', AmenityChips);
  Vue.component('price-breakdown', PriceBreakdown);
  Vue.component('payment-form', PaymentForm);
  Vue.component('slot-map', SlotMap);
  Vue.component('demo-clock', DemoClock);
  Vue.prototype.$toast = toast;
  Vue.prototype.$money = money;
}
