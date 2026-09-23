// 4-step booking flow:  1 When & vehicle  ->  2 Slot map  ->  3 Extras  ->  4 Review & pay
//
// TIME HANDLING (the "wrong date/time" bug): the browser converts the LOCAL date+time the driver typed into a UTC
// ISO string ("2026-09-21T13:00:00Z") before sending it, and the server echoes UTC back. Everything shown on
// screen is formatted in the viewer's own timezone. "Now" comes from the server-corrected clock, so a wrong device
// clock can't create bookings in the past.
import { get, post } from '../../api.js';
import { nowMs } from '../../clock.js';
import { clock } from '../../clock.js';
import { money, dt, timeOnly, dateLong, duration, toIso, localToMs, nextSlotTime, todayKey, addDaysKey, localTimezone, VEHICLE_TYPES } from '../../format.js';
import { amenityPrice } from './FindParking.js';

const DURATIONS = [30, 60, 90, 120, 180, 240, 360, 480, 720, 1440];
const STEPS = ['When & vehicle', 'Choose slot', 'Extras', 'Review & pay'];
const VEH_RE = /^[A-Z0-9]{4,12}$/;

const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

export default {
  data() {
    const q = this.$route.query;
    const d = nextSlotTime(nowMs());
    const dur = parseInt(q.dur, 10);
    return {
      clock, loading: true, error: '', lot: null, fineDue: 0, fineBooking: null,
      step: 1, maxStep: 1,
      form: {
        date: /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : d.date,
        time: /^\d{1,2}:\d{2}$/.test(q.time || '') ? q.time : d.time,
        dur: dur >= 30 && dur <= 4320 ? dur : 120,
        vehicle: lsGet('vp_vehicle'), vtype: lsGet('vp_vtype') || 'car',
        slotId: null, addons: [],
      },
      touched: false,
      durations: DURATIONS, steps: STEPS, vtypes: VEHICLE_TYPES,
      map: null, mapLoading: false, mapError: '',
      quote: null, quoteLoading: false, quoteError: '',
      pay: { payload: null, valid: false },
      busy: false, submitError: '', result: null,
      tz: localTimezone(),
    };
  },
  computed: {
    startMs() { return localToMs(this.form.date, this.form.time); },
    endMs() { return this.startMs + this.form.dur * 60000; },
    startIso() { return isNaN(this.startMs) ? '' : toIso(new Date(this.startMs)); },
    endIso() { return isNaN(this.endMs) ? '' : toIso(new Date(this.endMs)); },
    minDate() { return todayKey(this.clock.now); },
    maxDate() { return addDaysKey(this.clock.now, 30); },
    timeError() {
      if (isNaN(this.startMs)) return 'Choose a date and a start time.';
      if (this.startMs < nowMs() - 2 * 60000) return 'That start time has already passed - pick a later time.';
      if (this.startMs > nowMs() + 30 * 86400000) return 'You can book at most 30 days ahead.';
      if (!(this.form.dur >= 30)) return 'The minimum booking is 30 minutes.';
      if (this.form.dur > 72 * 60) return 'The maximum booking is 72 hours.';
      return '';
    },
    vehicleNorm() { return (this.form.vehicle || '').toUpperCase().replace(/[\s-]/g, ''); },
    vehicleError() { return VEH_RE.test(this.vehicleNorm) ? '' : 'Enter a valid vehicle number (4-12 letters/digits), e.g. KA01AB1234.'; },
    step1Ok() { return !this.timeError && !this.vehicleError; },
    bookable() { return this.lot ? this.lot.amenities.filter(a => a.category === 'bookable') : []; },
    onsite() { return this.lot ? this.lot.amenities.filter(a => a.category !== 'bookable') : []; },
    hours() { return Math.ceil(this.form.dur / 60); },
    estimate() {
      if (!this.lot) return 0;
      return Math.round(this.lot.price_per_hour * Math.ceil(this.form.dur / 15) * 15 / 60 * 100) / 100;
    },
    slotInfo() {
      if (!this.map || !this.form.slotId) return null;
      for (const f of this.map.floors) {
        const s = f.slots.find(x => x.id === this.form.slotId);
        if (s) return { id: s.id, label: s.full_label, type: s.type, floor: f.floor, row: s.row_name, bay: s.col + 1, text: `Level ${f.floor} · Row ${s.row_name} · Bay ${s.col + 1}` };
      }
      return null;
    },
    freeCount() { return this.map ? this.map.counts.available : 0; },
    total() { return this.quote ? this.quote.total : this.estimate; },
    releaseIso() { return this.lot && !isNaN(this.endMs) ? toIso(new Date(this.endMs + this.lot.buffer_minutes * 60000)) : ''; },
    fineRate() { return this.lot ? Math.round(this.lot.price_per_hour * 1.5 / 4 * 100) / 100 : 0; },
    needsPayment() { return !this.quote || this.quote.total > 0; },
    canPay() { return !!this.quote && !this.busy && !this.fineDue && (!this.needsPayment || this.pay.valid); },
  },
  async created() {
    // The lot fetch and the bookings/fine fetch are independent (not Promise.all): a hiccup loading
    // the rider's booking history shouldn't stop them opening a lot that loaded fine. Only a failure
    // to load the LOT ITSELF blocks the page with "Can't open this lot".
    try {
      this.lot = await get('/api/lots/' + this.$route.params.lotId);
    } catch (e) {
      this.error = e.status === 404 ? 'This parking lot is not available for booking.' : e.message;
      this.loading = false;
      return;
    }
    try {
      const b = await get('/api/bookings');
      this.fineDue = b.summary.fines_due;
      this.fineBooking = b.bookings.find(x => x.amounts.fine_status === 'due') || null;
      if (!this.form.vehicle && b.bookings.length) this.form.vehicle = b.bookings[0].vehicle_number;
    } catch (e) {
      // Non-fatal: the lot still opens; fine/vehicle-prefill info is just unavailable this load.
    }
    if (this.startMs < nowMs() - 2 * 60000) { const d = nextSlotTime(nowMs()); this.form.date = d.date; this.form.time = d.time; }
    this.loading = false;
  },
  watch: {
    // Changing the time invalidates the slot map, the chosen slot and the quote: start over from step 1.
    startIso() { this.resetAfterTimeChange(); },
    endIso() { this.resetAfterTimeChange(); },
  },
  methods: {
    resetAfterTimeChange() {
      if (this.step !== 1) return;
      this.map = null; this.quote = null; this.form.slotId = null; this.maxStep = 1;
    },
    money, dt, timeOnly, dateLong, duration, amenityPrice,
    // ---------------------------------------------------------------- navigation
    goStep(n) {
      if (n > this.maxStep || this.result) return;
      if (n >= 3 && !this.form.slotId) n = 2;
      this.step = n;
      if (n === 2) this.loadMap();
      if (n === 4) this.loadQuote();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    next() {
      this.submitError = '';
      if (this.step === 1) {
        this.touched = true;
        if (!this.step1Ok) return;
      }
      if (this.step === 2 && !this.form.slotId) { this.$toast.error('Tap a free (white/green) slot on the map first.'); return; }
      const n = this.step + 1;
      this.maxStep = Math.max(this.maxStep, n);
      this.goStep(n);
    },
    back() { this.goStep(this.step - 1); },

    // ---------------------------------------------------------------- slot map
    async loadMap() {
      this.mapLoading = true; this.mapError = '';
      try {
        this.map = await get(`/api/lots/${this.lot.id}/slot-map`, { start: this.startIso, end: this.endIso });
        if (this.form.slotId && !this.slotInfo) this.form.slotId = null;
        if (this.form.slotId) {
          const still = this.map.floors.some(f => f.slots.some(s => s.id === this.form.slotId && s.status === 'available'));
          if (!still) { this.form.slotId = null; this.$toast.info('Your previously chosen slot is not free for this time - please pick another.'); }
        }
      } catch (e) { this.mapError = e.message; }
      this.mapLoading = false;
    },
    pickSlot(s) {
      if (s.status !== 'available') {
        const why = { booked: 'That slot is already booked for this time.', buffer: `That slot is in its ${this.lot.buffer_minutes}-minute turnaround gap between two bookings.`, blocked: 'That slot is closed.' }[s.status];
        if (why) this.$toast.error(why);
        return;
      }
      this.form.slotId = s.id; this.quote = null;
    },
    autoPick() {
      if (!this.map) return;
      const all = [];
      this.map.floors.forEach(f => f.slots.forEach(s => { if (s.status === 'available') all.push({ f: f.floor, s }); }));
      if (!all.length) { this.$toast.error('No free slots for this time. Try another time or lot.'); return; }
      const wantEv = this.form.vtype === 'ev';
      const score = x => (wantEv ? (x.s.type === 'ev' ? 0 : 1000) : (x.s.type === 'ev' ? 1000 : 0)) + x.f * 100 + x.s.row * 10 + x.s.col;
      all.sort((a, b) => score(a) - score(b));
      this.form.slotId = all[0].s.id; this.quote = null;
    },

    // ---------------------------------------------------------------- extras + quote
    toggleAddon(code) {
      const i = this.form.addons.indexOf(code);
      if (i >= 0) this.form.addons.splice(i, 1); else this.form.addons.push(code);
      this.quote = null;
    },
    addonPrice(a) { return a.price_unit === 'per_hour' ? a.price * this.hours : a.price; },
    async loadQuote() {
      this.quoteLoading = true; this.quoteError = '';
      try {
        this.quote = await post('/api/bookings/quote', {
          lot_id: this.lot.id, slot_id: this.form.slotId, start: this.startIso, end: this.endIso, addons: this.form.addons,
        });
      } catch (e) {
        this.quote = null; this.quoteError = e.message;
        if (e.status === 409) { this.step = 2; this.form.slotId = null; this.loadMap(); }
      }
      this.quoteLoading = false;
    },

    // ---------------------------------------------------------------- confirm
    async confirm() {
      if (!this.canPay) return;
      this.busy = true; this.submitError = '';
      try {
        const r = await post('/api/bookings', {
          lot_id: this.lot.id, slot_id: this.form.slotId, start: this.startIso, end: this.endIso,
          addons: this.form.addons, vehicle_number: this.vehicleNorm, vehicle_type: this.form.vtype,
          payment: this.needsPayment ? this.pay.payload : undefined,
        });
        lsSet('vp_vehicle', this.vehicleNorm); lsSet('vp_vtype', this.form.vtype);
        this.result = r.booking;
        this.$root.$emit('bookings-changed');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        this.submitError = e.message;
        if (e.code === 'bad_vehicle') this.step = 1;
        else if (e.status === 409) { this.step = 2; this.form.slotId = null; this.quote = null; this.loadMap(); this.$toast.error(e.message); }
      }
      this.busy = false;
    },
  },
  template: `
  <div>
    <div v-if="loading" class="stack"><div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:360px"></div></div>
    <div v-else-if="error" class="card"><empty-state icon="bi-exclamation-circle" title="Can't open this lot" :text="error"><router-link to="/app/find" class="btn mt-2">Find parking</router-link></empty-state></div>

    <!-- ============ success ============ -->
    <div v-else-if="result" style="max-width:720px;margin:0 auto">
      <div class="card success-card">
        <div class="check"><i class="bi bi-check-lg"></i></div>
        <h2>You're booked!</h2>
        <p class="muted">A confirmation e-mail is on its way.</p>
        <div class="code-box">{{ result.code }}</div>
        <div class="grid grid-2 mt-3" style="text-align:left">
          <div class="pricebox"><div class="tiny muted strong">PARKING LOT</div><div class="strong">{{ result.lot.name }}</div><div class="small muted">{{ result.lot.address }}, {{ result.lot.city }}</div></div>
          <div class="pricebox"><div class="tiny muted strong">YOUR SLOT</div><div class="strong">{{ result.slot.full_label }}</div><div class="small muted">{{ result.slot.location }}</div></div>
          <div class="pricebox"><div class="tiny muted strong">FROM</div><div class="strong">{{ dt(result.start_time) }}</div></div>
          <div class="pricebox"><div class="tiny muted strong">UNTIL</div><div class="strong">{{ dt(result.end_time) }}</div></div>
        </div>
        <div class="flex gap-2 wrap center mt-4">
          <router-link :to="'/app/bookings/' + result.id" class="btn btn-lg"><i class="bi bi-map"></i> View booking & slot map</router-link>
          <router-link to="/app" class="btn btn-lg btn-outline">Back home</router-link>
        </div>
      </div>
    </div>

    <!-- ============ wizard ============ -->
    <div v-else>
      <div class="page-head"><div><h1>Book at {{ lot.name }}</h1><p><i class="bi bi-geo-alt"></i> {{ lot.address }}, {{ lot.city }} · {{ money(lot.price_per_hour) }}/hour</p></div>
        <router-link to="/app/find" class="btn btn-ghost btn-sm"><i class="bi bi-arrow-left"></i> Other lots</router-link></div>

      <div v-if="fineDue > 0" class="alert bad mb-3"><i class="bi bi-cash-coin"></i>
        <div class="grow"><b>You have an unpaid overstay fine of {{ money(fineDue) }}.</b> Please pay it before booking again.</div>
        <router-link v-if="fineBooking" :to="{ path: '/app/bookings/' + fineBooking.id, query: { action: 'pay-fine' } }" class="btn btn-sm btn-danger">Pay fine</router-link></div>

      <div class="stepper">
        <div v-for="(s, i) in steps" :key="s" :class="['stp', { active: step === i + 1, done: i + 1 < step || (i + 1 <= maxStep && step !== i + 1) }]" @click="goStep(i + 1)">
          <span class="n"><i v-if="i + 1 < step" class="bi bi-check-lg"></i><template v-else>{{ i + 1 }}</template></span>{{ s }}</div>
      </div>

      <div class="wiz">
        <div class="stack">
          <!-- STEP 1 -->
          <div class="card" v-show="step === 1">
            <div class="card-head"><h3><i class="bi bi-clock ok-text"></i> When are you parking?</h3></div>
            <div class="card-body">
              <div class="grid grid-2">
                <div class="field"><label for="w-date">Arrival date</label>
                  <input id="w-date" type="date" class="input" v-model="form.date" :min="minDate" :max="maxDate"></div>
                <div class="field"><label for="w-time">Arrival time</label>
                  <input id="w-time" type="time" class="input" v-model="form.time"></div>
              </div>
              <div class="field"><label>How long?</label>
                <div class="dur-grid">
                  <button v-for="m in durations" :key="m" type="button" :class="['dur', { active: form.dur === m }]" @click="form.dur = m">{{ duration(m) }}</button>
                </div>
                <div class="flex items-center gap-2 mt-2"><span class="small muted">or custom</span>
                  <input class="input" style="width:120px" type="number" min="30" max="4320" step="15" v-model.number="form.dur" aria-label="Custom duration in minutes"><span class="small muted">minutes</span></div>
              </div>
              <div v-if="touched && timeError" class="alert bad small mb-2"><i class="bi bi-exclamation-circle"></i><div>{{ timeError }}</div></div>
              <div v-if="!timeError" class="when-summary">
                <div><small class="tiny muted strong">ARRIVE</small><b>{{ dt(startIso) }}</b></div>
                <i class="bi bi-arrow-right arrow"></i>
                <div><small class="tiny muted strong">LEAVE BY</small><b>{{ dt(endIso) }}</b></div>
                <div class="grow right"><small class="tiny muted strong">TOTAL</small><b>{{ duration(form.dur) }}</b></div>
              </div>
              <div class="hint mt-1"><i class="bi bi-globe2"></i> Times are in your local timezone ({{ tz }}). Minimum 30 min, maximum 72 h, up to 30 days ahead. Billed per started 15 minutes.</div>

              <hr class="divider">
              <div class="grid grid-2">
                <div class="field"><label for="w-veh">Vehicle number</label>
                  <input id="w-veh" class="input mono" placeholder="KA01AB1234" maxlength="14" v-model="form.vehicle" :class="{ invalid: touched && vehicleError }" style="text-transform:uppercase">
                  <div class="error-text" v-if="touched && vehicleError">{{ vehicleError }}</div></div>
                <div class="field"><label>Vehicle type</label>
                  <div class="veh-types"><button type="button" v-for="v in vtypes" :key="v.v" :class="['veh', { active: form.vtype === v.v }]" @click="form.vtype = v.v"><i :class="['bi', v.i]"></i>{{ v.l }}</button></div></div>
              </div>
            </div>
          </div>

          <!-- STEP 2 -->
          <div v-show="step === 2" class="stack">
            <div class="card card-pad flex between items-center wrap gap-2">
              <div><div class="strong">{{ dateLong(startIso) }}</div><div class="small muted">{{ timeOnly(startIso) }} → {{ timeOnly(endIso) }} · {{ duration(form.dur) }}</div></div>
              <div class="flex gap-1 wrap"><span class="pill ok"><span class="dot"></span>{{ freeCount }} free</span><button class="btn btn-sm btn-soft" @click="autoPick" :disabled="mapLoading || !map"><i class="bi bi-magic"></i> Pick the best for me</button></div>
            </div>
            <div v-if="mapError" class="alert bad"><i class="bi bi-exclamation-circle"></i><div class="grow">{{ mapError }}</div><button class="btn btn-sm btn-outline" @click="loadMap">Retry</button></div>
            <div v-if="mapLoading && !map" class="skeleton" style="height:340px"></div>
            <slot-map v-if="map" :floors="map.floors" :selected-id="form.slotId" :buffer="map.buffer_minutes" @select="pickSlot">
              <template slot="head"><button class="btn btn-sm btn-outline" @click="loadMap" :disabled="mapLoading"><i :class="['bi', 'bi-arrow-repeat']"></i> Refresh</button></template>
            </slot-map>
            <div class="sel-slot" v-if="slotInfo">
              <div class="big">{{ slotInfo.label }}</div>
              <div class="grow"><b>{{ slotInfo.text }}</b><small>{{ slotInfo.type === 'ev' ? 'EV charging bay' : slotInfo.type === 'accessible' ? 'Accessible bay' : 'Standard bay' }} · free until {{ timeOnly(releaseIso) }} incl. {{ lot.buffer_minutes }}-min turnaround</small></div>
              <i class="bi bi-check-circle-fill" style="color:var(--brand-400);font-size:1.5rem"></i>
            </div>
            <div class="hint" v-else>Tap a free slot to select it. Slots marked with a hatched pattern are resting between two bookings.</div>
          </div>

          <!-- STEP 3 -->
          <div v-show="step === 3" class="stack">
            <div class="card">
              <div class="card-head"><h3><i class="bi bi-plus-circle ok-text"></i> Add extras <span class="muted small">(optional)</span></h3></div>
              <div class="card-body stack">
                <label v-for="a in bookable" :key="a.code" :class="['addon', { on: form.addons.includes(a.code) }]">
                  <input type="checkbox" :checked="form.addons.includes(a.code)" @change="toggleAddon(a.code)">
                  <span class="amenity-icon"><i :class="['bi', a.icon]"></i></span>
                  <div class="grow"><b>{{ a.name }}</b><div class="small muted">{{ a.description }}<template v-if="a.location"> · {{ a.location }}</template></div></div>
                  <div class="right strong">{{ money(addonPrice(a)) }}<div class="tiny muted" v-if="a.price_unit === 'per_hour'">{{ money(a.price) }} × {{ hours }} h</div></div>
                </label>
                <empty-state v-if="!bookable.length" icon="bi-emoji-smile" title="No bookable extras at this lot" text="You can still use the on-site amenities below."></empty-state>
              </div>
            </div>
            <div class="card" v-if="onsite.length">
              <div class="card-head"><h3><i class="bi bi-shop ok-text"></i> Also on site</h3><span class="small muted">pay directly at the counter</span></div>
              <div class="card-body am-list">
                <div class="am-row" v-for="a in onsite" :key="a.code"><span class="amenity-icon" style="background:var(--line-2);color:var(--ink-2)"><i :class="['bi', a.icon]"></i></span>
                  <div class="grow"><b>{{ a.name }}</b><small>{{ a.location || a.description }}</small></div><span class="pill">{{ amenityPrice(a) }}</span></div>
              </div>
            </div>
          </div>

          <!-- STEP 4 -->
          <div v-show="step === 4" class="stack">
            <div class="card">
              <div class="card-head"><h3><i class="bi bi-receipt ok-text"></i> Price</h3></div>
              <div class="card-body">
                <div v-if="quoteLoading" class="skeleton" style="height:120px"></div>
                <div v-else-if="quoteError" class="alert bad"><i class="bi bi-exclamation-circle"></i><div class="grow">{{ quoteError }}</div></div>
                <price-breakdown v-else-if="quote" :quote="quote" total-label="Total to pay now"></price-breakdown>
              </div>
            </div>
            <div class="card" v-if="quote && quote.total > 0">
              <div class="card-head"><h3><i class="bi bi-credit-card ok-text"></i> Payment</h3><span class="pill ok"><i class="bi bi-shield-lock"></i> Demo gateway</span></div>
              <div class="card-body"><payment-form :amount="quote.total" @change="pay = $event"></payment-form></div>
            </div>
            <div class="alert ok" v-else-if="quote"><i class="bi bi-gift"></i><div>Nothing to pay - this booking is fully covered by your free allowance or plan.</div></div>

            <div class="card card-pad stack">
              <div class="strong"><i class="bi bi-info-circle ok-text"></i> Before you confirm</div>
              <div class="buffer-note"><i class="bi bi-hourglass-split"></i><div>The slot is kept free for <b>{{ lot.buffer_minutes }} minutes</b> after your time so the next driver can use it. If you want more time, <b>extend</b> from your booking page before {{ timeOnly(endIso) }}.</div></div>
              <div class="buffer-note" style="background:var(--bad-bg);color:#8a1f26"><i class="bi bi-exclamation-triangle"></i><div>Staying past {{ timeOnly(endIso) }} costs an <b>overstay fine of {{ money(fineRate) }} per started 15 min</b> (1.5× the hourly rate).</div></div>
              <div class="small muted"><i class="bi bi-arrow-counterclockwise"></i> Free cancellation up to 60 minutes before you start (50% refund after that).</div>
            </div>
            <div v-if="submitError" class="alert bad" role="alert"><i class="bi bi-exclamation-octagon"></i><div>{{ submitError }}</div></div>
          </div>

          <!-- nav buttons -->
          <div class="flex between wrap gap-2">
            <button class="btn btn-outline" v-if="step > 1" @click="back"><i class="bi bi-arrow-left"></i> Back</button><span v-else></span>
            <button class="btn btn-lg" v-if="step < 4" @click="next" :disabled="step === 2 && !form.slotId">Continue <i class="bi bi-arrow-right"></i></button>
            <button class="btn btn-lg" v-else @click="confirm" :disabled="!canPay">
              <span v-if="busy" class="spin"></span><i v-else class="bi bi-lock"></i>
              {{ busy ? 'Processing…' : (quote && quote.total > 0 ? 'Pay ' + money(quote.total) + ' & confirm' : 'Confirm booking') }}</button>
          </div>
        </div>

        <!-- sticky summary -->
        <aside class="wiz-side">
          <div class="card">
            <div class="card-head"><h3>Your booking</h3></div>
            <div class="card-body">
              <div class="summary-line"><i class="bi bi-buildings"></i><div><b>{{ lot.name }}</b><small>{{ lot.city }}</small></div></div>
              <div class="summary-line"><i class="bi bi-calendar3"></i><div><b v-if="!timeError">{{ dt(startIso) }}</b><b v-else class="muted">Choose date & time</b><small v-if="!timeError">until {{ dt(endIso) }} · {{ duration(form.dur) }}</small></div></div>
              <div class="summary-line"><i class="bi bi-p-square"></i><div><b v-if="slotInfo">{{ slotInfo.label }}</b><b v-else class="muted">No slot chosen yet</b><small v-if="slotInfo">{{ slotInfo.text }}</small></div></div>
              <div class="summary-line"><i class="bi bi-car-front"></i><div><b>{{ vehicleNorm || '—' }}</b><small>{{ form.vtype }}</small></div></div>
              <div class="summary-line" v-if="form.addons.length"><i class="bi bi-plus-circle"></i><div><b>{{ form.addons.length }} extra{{ form.addons.length > 1 ? 's' : '' }}</b><small>{{ bookable.filter(a => form.addons.includes(a.code)).map(a => a.name).join(', ') }}</small></div></div>
              <div class="price-line total mt-2"><span>{{ quote ? 'Total' : 'Estimated parking' }}</span><span>{{ money(total) }}</span></div>
              <div class="tiny muted" v-if="!quote">Final price incl. extras & allowances is shown on the last step.</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>`,
};
