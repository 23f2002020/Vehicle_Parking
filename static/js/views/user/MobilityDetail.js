// One ride or one valet request, from the RIDER's side: progress rail, the assigned driver partner
// once one takes it, fare/fee + pay, handover photos (valet, read-only here - the driver captured
// them), and a rating prompt once completed. Mirrors PartnerJobDetail.js's layout on the other side
// of this feature, but the actions here are cancel / pay / rate instead of accept / advance / handover.
import { get, post } from '../../api.js';
import { money, dt, relTime } from '../../format.js';
import { rideMeta, valetMeta, ridePct, valetPct, ridePos, valetPos, RIDE_STEPS, VALET_STEPS,
        REQUEST_TYPE_LABEL, StarPicker, LiveRouteMap } from './mobilityLib.js';

export default {
  components: { StarPicker, LiveRouteMap },
  data() {
    return {
      loading: true, error: '', job: null, busy: false, actionError: '',
      modal: null, // 'cancel' | 'pay' | 'rate' | null
      cancelReason: '', pay: { payload: null, valid: false }, rating: { stars: 0, review: '' },
    };
  },
  computed: {
    kind() { return this.$route.params.kind === 'valet' ? 'valet' : 'ride'; },
    id() { return Number(this.$route.params.id); },
    meta() { return this.job ? (this.kind === 'ride' ? rideMeta(this.job.status) : valetMeta(this.job.status)) : null; },
    steps() { return this.kind === 'ride' ? RIDE_STEPS : VALET_STEPS; },
    stepIndex() { return this.job ? this.steps.indexOf(this.job.status) : -1; },
    routePos() { return this.job ? (this.kind === 'ride' ? ridePos(this.job.status) : valetPos(this.job.status)) : 0; },
    cancelled() { return this.job && this.job.status === 'CANCELLED'; },
    requestTypeLabel() { return this.job && this.job.request_type ? (REQUEST_TYPE_LABEL[this.job.request_type] || this.job.request_type) : ''; },
    stepLabel() { return step => (this.kind === 'ride' ? rideMeta(step) : valetMeta(step)).label; },
    amount() { return this.kind === 'ride' ? (this.job && this.job.fare ? this.job.fare.total : 0) : (this.job ? this.job.fee : 0); },
    paid() { return this.kind === 'ride' ? !!(this.job && this.job.fare && this.job.fare.paid) : !!(this.job && this.job.paid); },
    fareLine() {
      if (this.kind !== 'ride' || !this.job || !this.job.fare) return [];
      const f = this.job.fare;
      const rows = [{ l: 'Base fare', v: f.base_fare }, { l: 'Distance', v: f.distance_fare }, { l: 'Time', v: f.time_fare }];
      if (f.waiting_fee) rows.push({ l: 'Waiting fee', v: f.waiting_fee });
      if (f.cancellation_fee) rows.push({ l: 'Cancellation fee', v: f.cancellation_fee });
      if (f.surge_multiplier && f.surge_multiplier !== 1) rows.push({ l: `Peak-hour surge (${f.surge_multiplier}×)`, v: null });
      return rows;
    },
    apiBase() { return this.kind === 'ride' ? `/api/rides/${this.id}` : `/api/valet/${this.id}`; },
  },
  async created() { await this.load(); },
  methods: {
    money, dt, relTime,
    async load() {
      try { this.job = await get(this.apiBase); this.error = ''; }
      catch (e) { this.error = e.status === 404 ? "We couldn't find this request." : e.message; }
      this.loading = false;
    },
    updated(job, msg) { this.job = job; if (msg) this.$toast.success(msg); },
    async act(action, body) {
      this.busy = true; this.actionError = '';
      try {
        const r = await post(`${this.apiBase}/${action}`, body || {});
        this.updated(this.kind === 'ride' ? r.ride : r.valet_request, r.message);
        this.modal = null;
      } catch (e) { this.actionError = e.message; this.$toast.error(e.message); }
      this.busy = false;
    },
    openPay() { this.modal = 'pay'; this.actionError = ''; this.pay = { payload: null, valid: false }; },
    openRate() { this.modal = 'rate'; this.actionError = ''; this.rating = { stars: 0, review: '' }; },
    async submitPay() { await this.act('pay', { payment: this.pay.payload }); },
    async submitRate() {
      if (!this.rating.stars) { this.actionError = 'Pick a star rating first.'; return; }
      await this.act('rate', { stars: this.rating.stars, review: this.rating.review });
    },
  },
  template: `
  <div>
    <div class="mb-2"><router-link :to="'/app/mobility?kind=' + kind" class="small strong"><i class="bi bi-arrow-left"></i> Rides &amp; valet</router-link></div>

    <div v-if="loading" class="stack"><div class="skeleton" style="height:150px"></div><div class="skeleton" style="height:180px"></div></div>
    <div v-else-if="error" class="card"><empty-state icon="bi-exclamation-circle" title="Not found" :text="error"><router-link to="/app/mobility" class="btn mt-2">Back</router-link></empty-state></div>

    <div v-else-if="job">
      <div class="card card-pad">
        <div class="flex between items-start wrap gap-2">
          <div>
            <div class="flex items-center gap-2 wrap"><span class="pill" :class="meta.cls"><i :class="['bi', meta.icon]"></i>{{ meta.label }}</span><span class="mono small muted">{{ job.code }}</span>
              <span v-if="kind === 'valet'" class="pill">{{ requestTypeLabel }}</span></div>
            <div class="job-route mt-2" style="font-size:1.1rem"><i class="bi bi-geo-alt-fill ok-text"></i>{{ job.pickup_label }}<i class="bi bi-arrow-right via"></i>{{ job.drop_label }}</div>
            <div class="small muted mt-1">{{ job.distance_km }} km · requested {{ relTime(job.requested_at, Date.now()) }}</div>
          </div>
        </div>

        <live-route-map class="mt-3" :pickup-label="job.pickup_label" :drop-label="job.drop_label"
                   :pickup-lat="job.pickup_lat" :pickup-lng="job.pickup_lng"
                   :drop-lat="job.drop_lat" :drop-lng="job.drop_lng"
                   :distance-km="job.distance_km" :pct="routePos" :cancelled="cancelled"></live-route-map>

        <div class="job-rail mt-3" v-if="!cancelled">
          <div v-for="(s, i) in steps" :key="s" :class="['jr-step', { done: i < stepIndex, now: i === stepIndex }]">
            <span class="jr-line"></span><span class="dot"><i v-if="i < stepIndex" class="bi bi-check"></i><template v-else>{{ i + 1 }}</template></span>
            <small>{{ stepLabel(s) }}</small>
          </div>
        </div>
        <div class="alert bad mt-2" v-else><i class="bi bi-x-circle"></i><div>Cancelled by {{ job.cancelled_by }}{{ job.cancel_reason ? ' - ' + job.cancel_reason : '' }} · {{ dt(job.cancelled_at) }}</div></div>

        <div v-if="job.vehicle_number" class="kv"><span>Vehicle</span><span class="mono">{{ job.vehicle_number }}</span></div>
        <div v-if="job.reservation_id" class="small mt-2"><i class="bi bi-link-45deg"></i> Linked to <router-link :to="'/app/bookings/' + job.reservation_id">your parking booking</router-link></div>

        <div v-if="actionError && !modal" class="alert bad mt-2"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>

        <div class="flex wrap gap-1 mt-3">
          <button class="btn" v-if="job.actions.can_pay" @click="openPay"><i class="bi bi-credit-card"></i> Pay {{ money(amount) }}</button>
          <button class="btn btn-soft" v-if="job.actions.can_rate" @click="openRate"><i class="bi bi-star"></i> Rate your driver partner</button>
          <button class="btn btn-ghost" v-if="job.actions.can_cancel" @click="modal = 'cancel'; actionError = ''"><i class="bi bi-x-circle"></i> Cancel</button>
        </div>
      </div>

      <!-- ===== driver partner ===== -->
      <div class="card mt-3" v-if="job.driver">
        <div class="card-head"><h3><i class="bi bi-person-badge ok-text"></i> Your driver partner</h3></div>
        <div class="card-body">
          <div class="kv"><span>Name</span><span class="strong">{{ job.driver.full_name }}</span></div>
          <div class="kv" v-if="job.driver.phone"><span>Phone</span><span>{{ job.driver.phone }}</span></div>
          <div class="kv" v-if="job.driver.vehicle"><span>Vehicle</span><span>{{ job.driver.vehicle.manufacturer }} {{ job.driver.vehicle.model }} · {{ job.driver.vehicle.reg_number }}</span></div>
        </div>
      </div>
      <div class="alert info mt-3" v-else-if="!cancelled"><i class="bi bi-hourglass-split"></i><div>Looking for a nearby driver partner - this updates automatically.</div></div>

      <!-- ===== fare / fee ===== -->
      <div class="card mt-3" v-if="(kind === 'ride' && job.fare) || (kind === 'valet' && job.fee)">
        <div class="card-head"><h3><i class="bi bi-receipt ok-text"></i> {{ kind === 'ride' ? 'Fare' : 'Fee' }}</h3>
          <span class="pill" :class="paid ? 'ok' : 'warn'">{{ paid ? 'Paid' : 'Payment pending' }}</span></div>
        <div class="card-body">
          <template v-if="kind === 'ride'">
            <div class="kv" v-for="(r, i) in fareLine" :key="i"><span>{{ r.l }}</span><span v-if="r.v != null">{{ money(r.v) }}</span></div>
            <div class="kv"><span class="strong" style="color:var(--ink)">Total</span><span style="font-size:1.1rem">{{ money(job.fare.total) }}</span></div>
          </template>
          <template v-else>
            <div class="kv" v-if="job.cancellation_fee"><span>Cancellation fee</span><span>{{ money(job.cancellation_fee) }}</span></div>
            <div class="kv"><span class="strong" style="color:var(--ink)">Total</span><span style="font-size:1.1rem">{{ money(job.fee) }}</span></div>
          </template>
        </div>
      </div>

      <!-- ===== handover proof (valet only, captured by the driver partner) ===== -->
      <div class="card mt-3" v-if="kind === 'valet' && job.handovers && job.handovers.length">
        <div class="card-head"><h3><i class="bi bi-camera ok-text"></i> Handover proof</h3></div>
        <div class="card-body handover-grid">
          <div class="handover-shot" v-for="(h, i) in job.handovers" :key="i">
            <img v-if="h.photo" :src="h.photo" alt="">
            <div v-else style="height:100px;display:grid;place-items:center;color:#98a0bf" class="tiny">No photo</div>
            <div class="cap"><b>{{ h.stage }}</b>
              <div class="muted">{{ dt(h.at) }}</div>
              <div v-if="h.fuel_level_percent != null">Fuel: {{ h.fuel_level_percent }}%</div>
              <div v-if="h.condition_notes">{{ h.condition_notes }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== CANCEL MODAL ===================== -->
    <modal v-if="modal === 'cancel' && job" title="Cancel this request?" @close="modal = null">
      <div class="stack">
        <div class="alert warn"><i class="bi bi-exclamation-triangle"></i><div>Cancelling after your driver partner is already on the way may attract a cancellation fee.</div></div>
        <div class="field"><label>Reason (optional)</label><textarea class="textarea" rows="3" v-model="cancelReason" placeholder="Let us know why"></textarea></div>
        <div v-if="actionError" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>
      </div>
      <template slot="footer">
        <button class="btn btn-outline" @click="modal = null">Keep it</button>
        <button class="btn btn-danger" :disabled="busy" @click="act('cancel', { reason: cancelReason })"><span v-if="busy" class="spin"></span>Yes, cancel</button>
      </template>
    </modal>

    <!-- ===================== PAY MODAL ===================== -->
    <modal v-if="modal === 'pay' && job" :title="'Pay ' + (kind === 'ride' ? 'fare' : 'fee')" @close="modal = null">
      <div class="stack">
        <div class="alert info small"><i class="bi bi-receipt"></i><div>Total due: <b>{{ money(amount) }}</b></div></div>
        <payment-form :amount="amount" @change="pay = $event"></payment-form>
        <div v-if="actionError" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>
      </div>
      <template slot="footer">
        <button class="btn btn-outline" @click="modal = null">Later</button>
        <button class="btn" :disabled="busy || !pay.valid" @click="submitPay"><span v-if="busy" class="spin"></span>Pay {{ money(amount) }}</button>
      </template>
    </modal>

    <!-- ===================== RATE MODAL ===================== -->
    <modal v-if="modal === 'rate' && job" title="Rate your driver partner" @close="modal = null">
      <div class="stack">
        <div style="text-align:center"><star-picker v-model="rating.stars"></star-picker></div>
        <div class="field"><label>Review (optional)</label><textarea class="textarea" rows="3" v-model="rating.review" placeholder="How was your trip?"></textarea></div>
        <div v-if="actionError" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>
      </div>
      <template slot="footer">
        <button class="btn btn-outline" @click="modal = null">Skip</button>
        <button class="btn" :disabled="busy || !rating.stars" @click="submitRate"><span v-if="busy" class="spin"></span>Submit rating</button>
      </template>
    </modal>
  </div>`,
};
