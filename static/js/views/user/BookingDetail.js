// One booking: live countdown, where-to-park directions + highlighted slot map, extend / check-in / check-out /
// pay fine / cancel, price summary and history.
import { get, post } from '../../api.js';
import { clock } from '../../clock.js';
import { money, moneyExact, dt, dateLong, timeOnly, range, duration, countdown, relTime } from '../../format.js';
import { amenityPrice } from './FindParking.js';

const EXT_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const LABEL = { upcoming: 'Starts in', ready: 'Starts in', parked: 'Time left', overstay: 'Overstaying by' };
const EVENT_ICON = { created: 'bi-check-circle', discount: 'bi-gift', extended: 'bi-plus-circle', checked_in: 'bi-box-arrow-in-right',
  checked_out: 'bi-box-arrow-right', fine: 'bi-exclamation-triangle', fine_paid: 'bi-cash-coin', fine_waived: 'bi-hand-thumbs-up',
  cancelled: 'bi-x-circle', no_show: 'bi-person-x' };

export default {
  data() {
    return {
      clock, loading: true, error: '', b: null, map: null, mapError: '', timer: null,
      showMap: true,
      modal: null,          // 'extend' | 'fine' | 'cancel' | null
      ext: { minutes: 0, quote: null, loading: false, error: '', maxExtra: null },
      pay: { payload: null, valid: false },
      busy: false, actionError: '',
      extOptions: EXT_OPTIONS,
    };
  },
  computed: {
    st() { return this.b ? this.b.status : ''; },
    startMs() { return this.b ? Date.parse(this.b.start_time) : 0; },
    endMs() { return this.b ? Date.parse(this.b.end_time) : 0; },
    remaining() {
      if (!this.b) return 0;
      if (this.st === 'overstay') return this.clock.now - this.endMs;
      if (this.st === 'parked') return this.endMs - this.clock.now;
      return this.startMs - this.clock.now;
    },
    clockText() {
      if (!['upcoming', 'ready', 'parked', 'overstay'].includes(this.st)) return '';
      const ms = this.remaining;
      return countdown(this.st === 'overstay' ? Math.abs(ms) : Math.max(0, ms));
    },
    heroLabel() { return LABEL[this.st] || ''; },
    pct() {
      if (this.st === 'overstay') return 100;
      if (this.st !== 'parked') return 0;
      return Math.max(0, Math.min(100, ((this.clock.now - this.startMs) / Math.max(1, this.endMs - this.startMs)) * 100));
    },
    live() { return ['upcoming', 'ready', 'parked', 'overstay'].includes(this.st); },
    canCheckOut() { return !!(this.b && this.b.checked_in_at && this.b.actions.can_check_out); },
    lotAmenities() { return this.b ? (this.b.lot.amenities || []) : []; },
    extChoices() {
      if (!this.b) return [];
      const max = this.b.max_extend_minutes;
      const list = EXT_OPTIONS.filter(m => m <= max);
      if (max >= 15 && max <= 480 && !list.includes(max) && max % 15 === 0) list.push(max);
      return list;
    },
    cancelRefund() {
      if (!this.b || this.b.refund_percent_if_cancelled == null) return 0;
      return Math.round(this.b.amounts.paid_for_booking * this.b.refund_percent_if_cancelled) / 100;
    },
    directions() {
      if (!this.b) return [];
      const s = this.b.slot;
      const steps = ['Drive in through the main entry gate.'];
      steps.push(s.floor > 1 ? `Take the ramp or lift up to Level ${s.floor}.` : 'Level 1 is the first level after the gate - no ramp needed.');
      const nth = ['1st', '2nd', '3rd'][s.row_idx] || `${s.row_idx + 1}th`;
      steps.push(`Row ${s.row} is the ${nth} row from the entrance (${s.row_idx === 0 ? 'closest to the gate' : 'follow the lane'}).`);
      steps.push(`Bay ${s.bay} - count ${s.bay} from the left. Look for slot ${s.label}.`);
      return steps;
    },
    events() { return this.b && this.b.events ? this.b.events.slice().reverse() : []; },
    mineAmenities() { return this.b ? this.b.addons : []; },
  },
  async created() {
    await this.load(true);
    this.timer = setInterval(() => this.load(false), 30000);
    this.$root.$on('clock-changed', this.reload);
  },
  beforeDestroy() { clearInterval(this.timer); this.$root.$off('clock-changed', this.reload); },
  methods: {
    money, moneyExact, dt, dateLong, timeOnly, range, duration, amenityPrice, relTime,
    reload() { return this.load(false); },
    async load(first) {
      try {
        this.b = await get('/api/bookings/' + this.$route.params.id);
        this.error = '';
        if (first) {
          const act = this.$route.query.action;
          if (act === 'extend' && this.b.actions.can_extend) this.openExtend();
          else if (act === 'pay-fine' && this.b.actions.can_pay_fine) this.openFine();
        }
        this.loadMap();
      } catch (e) {
        if (first) this.error = e.status === 404 ? 'We could not find this booking.' : e.message;
      }
      this.loading = false;
    },
    async loadMap() {
      if (!this.live || !this.showMap) return;
      try {
        this.map = await get(`/api/lots/${this.b.lot.id}/slot-map`, { start: this.b.start_time, end: this.b.end_time, exclude_booking: this.b.id });
        this.mapError = '';
      } catch (e) { this.mapError = e.message; }
    },
    changed(booking, msg) {
      this.b = booking;
      this.$root.$emit('bookings-changed');
      if (msg) this.$toast.success(msg);
      this.loadMap();
    },
    async act(name, label) {
      this.busy = true; this.actionError = '';
      try {
        const r = await post(`/api/bookings/${this.b.id}/${name}`);
        this.changed(r.booking, r.message);
        if (name === 'check-out' && r.booking.actions.can_pay_fine) this.openFine();
      } catch (e) { this.actionError = e.message; this.$toast.error(e.message); }
      this.busy = false;
    },

    // ---------------------------------------------------------------- extend
    openExtend() {
      this.modal = 'extend'; this.actionError = '';
      this.ext = { minutes: 0, quote: null, loading: false, error: '', maxExtra: this.b.max_extend_minutes };
      this.pay = { payload: null, valid: false };
      if (this.extChoices.length) this.pickExt(this.extChoices[Math.min(1, this.extChoices.length - 1)]);
    },
    async pickExt(m) {
      this.ext.minutes = m; this.ext.quote = null; this.ext.error = ''; this.ext.loading = true;
      try {
        this.ext.quote = await post(`/api/bookings/${this.b.id}/extend-quote`, { extra_minutes: m });
        this.ext.maxExtra = this.ext.quote.max_extra_minutes;
      } catch (e) { this.ext.error = e.message; if (e.data && e.data.max_extra_minutes != null) this.ext.maxExtra = e.data.max_extra_minutes; }
      this.ext.loading = false;
    },
    async doExtend() {
      this.busy = true; this.actionError = '';
      try {
        const r = await post(`/api/bookings/${this.b.id}/extend`, { extra_minutes: this.ext.minutes, payment: this.pay.payload });
        this.modal = null;
        this.changed(r.booking, `${r.message} - charged ${money(r.charged)}`);
      } catch (e) { this.actionError = e.message; }
      this.busy = false;
    },

    // ---------------------------------------------------------------- fine
    openFine() { this.modal = 'fine'; this.actionError = ''; this.pay = { payload: null, valid: false }; },
    async doPayFine() {
      this.busy = true; this.actionError = '';
      try {
        const r = await post(`/api/bookings/${this.b.id}/pay-fine`, { payment: this.pay.payload });
        this.modal = null;
        this.changed(r.booking, r.message);
      } catch (e) { this.actionError = e.message; }
      this.busy = false;
    },

    // ---------------------------------------------------------------- cancel
    async doCancel() {
      this.busy = true; this.actionError = '';
      try {
        const r = await post(`/api/bookings/${this.b.id}/cancel`);
        this.modal = null;
        this.changed(r.booking, r.message);
      } catch (e) { this.actionError = e.message; }
      this.busy = false;
    },

    // ---------------------------------------------------------------- calendar file (.ics) - built in the browser
    ics() {
      const b = this.b, f = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VParkEasy//EN', 'BEGIN:VEVENT', `UID:${b.code}@vparkeasy`,
        `DTSTAMP:${f(new Date().toISOString())}`, `DTSTART:${f(b.start_time)}`, `DTEND:${f(b.end_time)}`,
        `SUMMARY:Parking at ${b.lot.name} (${b.slot.full_label})`, `LOCATION:${b.lot.address}\\, ${b.lot.city}`,
        `DESCRIPTION:Booking ${b.code} - ${b.slot.location} - vehicle ${b.vehicle_number}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
      a.download = `parking-${b.code}.ics`; document.body.appendChild(a); a.click(); a.remove();
    },
    evIcon(k) { return EVENT_ICON[k] || 'bi-dot'; },
    mapsLink() { const l = this.b.lot; return (l.latitude && l.longitude) ? `https://www.google.com/maps?q=${l.latitude},${l.longitude}` : `https://www.google.com/maps?q=${encodeURIComponent(l.name + ' ' + l.address + ' ' + (l.city || ''))}`; },
  },
  template: `
  <div>
    <div v-if="loading" class="stack"><div class="skeleton" style="height:190px"></div><div class="skeleton" style="height:320px"></div></div>
    <div v-else-if="error" class="card"><empty-state icon="bi-exclamation-circle" title="Booking not found" :text="error"><router-link to="/app/bookings" class="btn mt-2">My bookings</router-link></empty-state></div>

    <div v-else-if="b">
      <div class="mb-2"><router-link to="/app/bookings" class="small strong"><i class="bi bi-arrow-left"></i> My bookings</router-link></div>

      <!-- ===== hero ===== -->
      <section :class="['detail-hero', st]">
        <div class="flex between items-start wrap gap-2">
          <div>
            <div class="flex items-center gap-2 wrap"><status-pill :status="st"></status-pill><span class="mono" style="opacity:.85">{{ b.code }}</span></div>
            <h2 class="mt-2">{{ b.lot.name }}</h2>
            <div class="sub"><i class="bi bi-geo-alt"></i> {{ b.lot.address }}, {{ b.lot.city }} · <a :href="mapsLink()" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline">Open in Maps</a></div>
          </div>
          <div class="right"><div class="slot-badge" style="background:rgba(255,255,255,.18)"><i class="bi bi-p-square-fill"></i> {{ b.slot.full_label }}</div><div class="sub small mt-1">{{ b.slot.location }}</div></div>
        </div>

        <template v-if="live">
          <div class="mt-3 tiny" style="opacity:.85;font-weight:800;letter-spacing:.08em;text-transform:uppercase">{{ heroLabel }}</div>
          <div class="countdown">{{ clockText }}</div>
          <div class="sub" v-if="st === 'overstay'">Fine so far <b>{{ money(b.amounts.fine) }}</b> ({{ money(b.fine_rate_per_block) }} per started 15 min) - please check out now.</div>
          <div class="sub" v-else-if="st === 'parked'">Your time ends at {{ dt(b.end_time) }}</div>
          <div class="sub" v-else>{{ range(b.start_time, b.end_time) }}</div>
          <div class="progress mt-2" v-if="st === 'parked' || st === 'overstay'"><i :style="{ width: pct + '%' }"></i></div>
        </template>
        <div v-else class="mt-3 sub">
          <template v-if="st === 'completed'">You left at {{ dt(b.checked_out_at) }}. Thanks for parking with us!</template>
          <template v-else-if="st === 'cancelled'">Cancelled {{ dt(b.cancelled_at) }}<template v-if="b.amounts.refund"> · refunded {{ money(b.amounts.refund) }}</template></template>
          <template v-else>This booking was never used.</template>
        </div>

        <div class="flex wrap gap-1 mt-3">
          <button class="btn" v-if="b.actions.can_check_in" :disabled="busy" @click="act('check-in')"><i class="bi bi-box-arrow-in-right"></i> I've arrived - check in</button>
          <button class="btn" v-if="b.actions.can_extend" @click="openExtend"><i class="bi bi-plus-circle"></i> Extend time</button>
          <button class="btn" v-if="canCheckOut" :disabled="busy" @click="act('check-out')"><i class="bi bi-box-arrow-right"></i> Check out</button>
          <button class="btn btn-danger" v-if="b.actions.can_pay_fine" @click="openFine"><i class="bi bi-cash-coin"></i> Pay fine {{ money(b.amounts.fine) }}</button>
          <button class="btn btn-ghost" v-if="b.actions.can_cancel" @click="modal = 'cancel'; actionError = ''"><i class="bi bi-x-circle"></i> Cancel booking</button>
          <button class="btn btn-ghost" v-if="live" @click="ics"><i class="bi bi-calendar-plus"></i> Add to calendar</button>
        </div>
        <div v-if="!b.actions.can_extend && b.actions.extend_blocked_reason && live && st !== 'overstay'" class="small mt-2" style="opacity:.9"><i class="bi bi-info-circle"></i> {{ b.actions.extend_blocked_reason }}</div>
        <div v-if="st === 'upcoming'" class="small mt-2" style="opacity:.9"><i class="bi bi-info-circle"></i> Check-in opens 15 minutes before your start time.</div>
        <div v-if="actionError && !modal" class="alert bad mt-2"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>
      </section>

      <div class="two-col mt-3">
        <div class="stack">
          <!-- ===== where to park ===== -->
          <div class="card" v-if="live">
            <div class="card-head"><h3><i class="bi bi-signpost-2 ok-text"></i> How to find your slot</h3><span class="pill ok">{{ b.slot.location }}</span></div>
            <div class="card-body">
              <div class="grid grid-2">
                <ol class="dir-steps"><li v-for="(d, i) in directions" :key="i">{{ d }}</li></ol>
                <div class="stack">
                  <div class="buffer-note" v-if="st !== 'overstay'"><i class="bi bi-hourglass-split"></i><div>After you leave, this slot rests for <b>{{ b.buffer_minutes }} min</b> and opens to the next driver from <b>{{ timeOnly(b.slot_free_for_next_from) }}</b>.</div></div>
                  <div class="buffer-note" style="background:var(--bad-bg);color:#8a1f26" v-else><i class="bi bi-exclamation-triangle"></i><div>Another driver may be booked on this slot soon. Every extra 15 minutes costs {{ money(b.fine_rate_per_block) }}.</div></div>
                </div>
              </div>
              <div class="mt-3" v-if="map">
                <slot-map :floors="map.floors" :highlight-id="b.slot.id" :interactive="false" :buffer="map.buffer_minutes"></slot-map>
              </div>
              <div v-else-if="mapError" class="alert warn mt-2 small"><i class="bi bi-map"></i><div>{{ mapError }}</div></div>
            </div>
          </div>

          <!-- ===== amenities ===== -->
          <div class="card" v-if="lotAmenities.length">
            <div class="card-head"><h3><i class="bi bi-lightning-charge ok-text"></i> Amenities at this lot</h3></div>
            <div class="card-body am-list">
              <div class="am-row" v-for="a in lotAmenities" :key="a.code">
                <span class="amenity-icon" :style="a.category === 'bookable' ? '' : 'background:var(--line-2);color:var(--ink-2)'"><i :class="['bi', a.icon]"></i></span>
                <div class="grow"><b>{{ a.name }}</b><small v-if="a.location"><i class="bi bi-geo-alt"></i> {{ a.location }}</small></div>
                <span v-if="mineAmenities.some(m => m.code === a.code)" class="pill ok"><i class="bi bi-check2"></i> In your booking</span>
                <span v-else class="pill">{{ amenityPrice(a) }}</span>
              </div>
            </div>
          </div>

          <!-- ===== history ===== -->
          <div class="card" v-if="events.length">
            <div class="card-head"><h3><i class="bi bi-clock-history ok-text"></i> Activity</h3></div>
            <div class="card-body"><div class="timeline">
              <div v-for="(e, i) in events" :key="i" :class="['tl-item', e.kind === 'fine' ? 'bad' : (e.kind === 'cancelled' ? 'warn' : '')]">
                <div><i :class="['bi', evIcon(e.kind)]"></i> {{ e.message }}<b v-if="e.amount" class="nowrap"> · {{ e.amount < 0 ? '−' : '' }}{{ money(Math.abs(e.amount)) }}</b></div>
                <div class="when">{{ dt(e.at) }}</div>
              </div>
            </div></div>
          </div>
        </div>

        <aside class="stack">
          <div class="card" v-if="live">
            <div class="card-head"><h3><i class="bi bi-car-front ok-text"></i> Need a ride or valet?</h3></div>
            <div class="card-body">
              <p class="small muted mb-2">Link a ride or valet parking request to this booking.</p>
              <div class="flex wrap gap-1">
                <router-link :to="{ path: '/app/mobility/ride/new', query: { reservation_id: b.id } }" class="btn btn-sm btn-outline"><i class="bi bi-car-front"></i> Book a ride</router-link>
                <router-link :to="{ path: '/app/mobility/valet/new', query: { reservation_id: b.id } }" class="btn btn-sm btn-outline"><i class="bi bi-key"></i> Request valet</router-link>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>Booking details</h3></div>
            <div class="card-body">
              <div class="kv"><span>Booking code</span><span class="mono">{{ b.code }}</span></div>
              <div class="kv"><span>Vehicle</span><span>{{ b.vehicle_number }}</span></div>
              <div class="kv"><span>Arrive</span><span>{{ dt(b.start_time) }}</span></div>
              <div class="kv"><span>Leave by</span><span>{{ dt(b.end_time) }}</span></div>
              <div class="kv"><span>Duration</span><span>{{ duration(b.duration_minutes) }}<template v-if="b.extension_count"> (extended {{ b.extension_count }}×)</template></span></div>
              <div class="kv" v-if="b.checked_in_at"><span>Checked in</span><span>{{ dt(b.checked_in_at) }}</span></div>
              <div class="kv" v-if="b.checked_out_at"><span>Checked out</span><span>{{ dt(b.checked_out_at) }}</span></div>
              <div class="kv"><span>Hourly rate</span><span>{{ money(b.hourly_rate) }}</span></div>
              <div class="kv"><span>Paid with</span><span>{{ b.payment_method }}</span></div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>Payment summary</h3></div>
            <div class="card-body">
              <div class="kv"><span>Parking</span><span>{{ moneyExact(b.amounts.base) }}</span></div>
              <div class="kv" v-if="b.amounts.discount"><span>Free allowance / plan</span><span class="ok-text">−{{ moneyExact(b.amounts.discount) }}</span></div>
              <div class="kv" v-if="b.amounts.addons"><span>Extras</span><span>{{ moneyExact(b.amounts.addons) }}</span></div>
              <div class="kv" v-if="b.amounts.extension"><span>Extensions</span><span>{{ moneyExact(b.amounts.extension) }}</span></div>
              <div class="kv" v-if="b.amounts.fine > 0"><span>Overstay fine <span :class="['pill', b.amounts.fine_status === 'paid' ? 'ok' : b.amounts.fine_status === 'waived' ? '' : 'bad']">{{ b.amounts.fine_is_live ? 'accruing' : b.amounts.fine_status }}</span></span><span :class="b.amounts.fine_status === 'due' ? 'bad-text' : ''">{{ moneyExact(b.amounts.fine) }}</span></div>
              <div class="kv" v-if="b.amounts.refund"><span>Refund</span><span class="ok-text">−{{ moneyExact(b.amounts.refund) }}</span></div>
              <div class="kv"><span class="strong" style="color:var(--ink)">Net paid</span><span style="font-size:1.1rem">{{ moneyExact(b.amounts.total_paid) }}</span></div>
              <div v-if="b.transactions && b.transactions.length" class="mt-2">
                <div class="tiny muted strong mb-1">TRANSACTIONS</div>
                <div class="kv" v-for="t in b.transactions" :key="t.ref"><span class="small"><span class="mono">{{ t.ref.slice(-8) }}</span> · {{ t.purpose }}<template v-if="t.status !== 'success'"> · <span class="bad-text">{{ t.status }}</span></template></span><span>{{ t.purpose === 'refund' ? '−' : '' }}{{ moneyExact(t.amount) }}</span></div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>

    <!-- ===================== EXTEND MODAL ===================== -->
    <modal v-if="modal === 'extend' && b" title="Extend your parking" @close="modal = null">
      <div v-if="!extChoices.length" class="alert warn"><i class="bi bi-slash-circle"></i><div>{{ b.actions.extend_blocked_reason || 'This slot cannot be extended.' }}</div></div>
      <div v-else class="stack">
        <div class="small muted">Current end time: <b>{{ dt(b.end_time) }}</b>. You can add up to <b>{{ duration(b.max_extend_minutes) }}</b> - the slot is reserved after that (plus a {{ b.buffer_minutes }}-min turnaround gap).</div>
        <div class="field mb-0"><label>Add how much time?</label>
          <div class="ext-opts"><button v-for="m in extChoices" :key="m" type="button" :class="['dur', { active: ext.minutes === m }]" @click="pickExt(m)">+{{ duration(m) }}</button></div></div>
        <div v-if="ext.loading" class="skeleton" style="height:70px"></div>
        <div v-else-if="ext.error" class="alert bad small"><i class="bi bi-exclamation-circle"></i><div>{{ ext.error }}</div></div>
        <div v-else-if="ext.quote" class="pricebox">
          <div class="price-line"><span>New end time</span><span>{{ dt(ext.quote.new_end) }}</span></div>
          <div class="price-line"><span>+{{ duration(ext.quote.extra_minutes) }} @ {{ money(ext.quote.rate) }}/hr</span><span>{{ money(ext.quote.amount) }}</span></div>
          <div class="price-line total"><span>Extra to pay</span><span>{{ money(ext.quote.amount) }}</span></div>
        </div>
        <payment-form :amount="ext.quote ? ext.quote.amount : 0" @change="pay = $event"></payment-form>
        <div v-if="actionError" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>
      </div>
      <template slot="footer">
        <button class="btn btn-outline" @click="modal = null">Cancel</button>
        <button class="btn" v-if="extChoices.length" :disabled="busy || !ext.quote || !pay.valid" @click="doExtend"><span v-if="busy" class="spin"></span>Pay {{ ext.quote ? money(ext.quote.amount) : '' }} & extend</button>
      </template>
    </modal>

    <!-- ===================== FINE MODAL ===================== -->
    <modal v-if="modal === 'fine' && b" title="Pay overstay fine" @close="modal = null">
      <div class="stack">
        <div class="alert bad"><i class="bi bi-exclamation-triangle-fill"></i><div>You stayed <b>{{ b.overstay_minutes }} min</b> past your booked time at {{ b.lot.name }}. Fine: <b>{{ money(b.amounts.fine) }}</b> ({{ money(b.fine_rate_per_block) }} per started 15 min).</div></div>
        <payment-form :amount="b.amounts.fine" @change="pay = $event"></payment-form>
        <div v-if="actionError" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>
      </div>
      <template slot="footer">
        <button class="btn btn-outline" @click="modal = null">Later</button>
        <button class="btn btn-danger" :disabled="busy || !pay.valid" @click="doPayFine"><span v-if="busy" class="spin"></span>Pay {{ money(b.amounts.fine) }}</button>
      </template>
    </modal>

    <!-- ===================== CANCEL MODAL ===================== -->
    <modal v-if="modal === 'cancel' && b" title="Cancel this booking?" @close="modal = null">
      <div class="stack">
        <div>You are cancelling <b>{{ b.lot.name }}</b>, slot <b>{{ b.slot.full_label }}</b> on <b>{{ dt(b.start_time) }}</b>.</div>
        <div class="alert info" v-if="b.amounts.paid_for_booking > 0"><i class="bi bi-arrow-counterclockwise"></i>
          <div>You will get <b>{{ b.refund_percent_if_cancelled }}%</b> back ({{ money(cancelRefund) }}).
            <span v-if="b.refund_percent_if_cancelled < 100"> Cancelling more than 60 minutes before the start gives a full refund.</span></div></div>
        <div class="alert ok" v-else><i class="bi bi-check-circle"></i><div>Your free allowance minutes will be returned to your account.</div></div>
        <div v-if="actionError" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>
      </div>
      <template slot="footer">
        <button class="btn btn-outline" @click="modal = null">Keep booking</button>
        <button class="btn btn-danger" :disabled="busy" @click="doCancel"><span v-if="busy" class="spin"></span>Yes, cancel</button>
      </template>
    </modal>
  </div>`,
};
