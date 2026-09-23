// One ride or one valet job, from the driver partner's side: progress rail, the one action
// that matters right now, handover photo capture (valet only), and fare/fee once it is known.
import { get, post } from '../../api.js';
import { money, dt, relTime } from '../../format.js';
import { partnerStore, refreshDriver, rideMeta, valetMeta, ridePct, valetPct, ridePos, valetPos, RIDE_STEPS, VALET_STEPS,
         REQUEST_TYPE_LABEL, PhotoPicker, LiveRouteMap } from './partnerLib.js';

export default {
  components: { PhotoPicker, LiveRouteMap },
  data() {
    return {
      store: partnerStore, loading: true, error: '', job: null, busy: false, actionError: '',
      modal: null, // 'cancel' | 'pickup' | 'dropoff' | null
      cancelReason: '',
      handover: { photo: null, condition_notes: '', fuel_level_percent: 80, location_label: '' },
    };
  },
  computed: {
    kind() { return this.$route.params.kind === 'valet' ? 'valet' : 'ride'; },
    id() { return Number(this.$route.params.id); },
    driver() { return this.store.driver; },
    meta() { return this.job ? (this.kind === 'ride' ? rideMeta(this.job.status) : valetMeta(this.job.status)) : null; },
    steps() { return this.kind === 'ride' ? RIDE_STEPS : VALET_STEPS; },
    pct() { return this.job ? (this.kind === 'ride' ? ridePct(this.job.status) : valetPct(this.job.status)) : 0; },
    routePos() { return this.job ? (this.kind === 'ride' ? ridePos(this.job.status) : valetPos(this.job.status)) : 0; },
    stepIndex() { return this.job ? this.steps.indexOf(this.job.status) : -1; },
    cancelled() { return this.job && this.job.status === 'CANCELLED'; },
    requestTypeLabel() { return this.job && this.job.request_type ? (REQUEST_TYPE_LABEL[this.job.request_type] || this.job.request_type) : ''; },
    stepLabel() { return step => (this.kind === 'ride' ? rideMeta(step) : valetMeta(step)).label; },
    fareLine() {
      if (this.kind !== 'ride' || !this.job || !this.job.fare) return [];
      const f = this.job.fare;
      const rows = [
        { l: 'Base fare', v: f.base_fare }, { l: 'Distance', v: f.distance_fare }, { l: 'Time', v: f.time_fare },
      ];
      if (f.waiting_fee) rows.push({ l: 'Waiting fee', v: f.waiting_fee });
      if (f.cancellation_fee) rows.push({ l: 'Cancellation fee', v: f.cancellation_fee });
      if (f.surge_multiplier && f.surge_multiplier !== 1) rows.push({ l: `Peak-hour surge (${f.surge_multiplier}×)`, v: null });
      return rows;
    },
  },
  async created() { await this.load(); },
  methods: {
    money, dt, relTime,
    apiBase() { return this.kind === 'ride' ? `/api/driver/rides/${this.id}` : `/api/driver/valet/${this.id}`; },
    async load() {
      try {
        await refreshDriver();
        const base = this.kind === 'ride' ? '/api/driver/rides' : '/api/driver/valet';
        const list = await get(base);
        const items = this.kind === 'ride' ? list.rides : list.valet_requests;
        this.job = items.find(j => j.id === this.id) || null;
        this.error = this.job ? '' : "This job wasn't found - it may have been reassigned.";
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    updated(job, msg) {
      this.job = job;
      this.$root.$emit('partner-changed');
      if (msg) this.$toast.success(msg);
    },
    async act(action, body) {
      this.busy = true; this.actionError = '';
      try {
        const r = await post(`${this.apiBase()}/${action}`, body || {});
        this.updated(this.kind === 'ride' ? r.ride : r.valet_request, r.message);
        this.modal = null;
      } catch (e) { this.actionError = e.message; this.$toast.error(e.message); }
      this.busy = false;
    },
    openCancel() { this.modal = 'cancel'; this.cancelReason = ''; this.actionError = ''; },
    openHandover(stage) {
      this.modal = stage; this.actionError = '';
      this.handover = { photo: null, condition_notes: '', fuel_level_percent: 80, location_label: '' };
    },
    async submitHandover(stage) {
      const action = stage === 'pickup' ? 'picked-up' : 'dropped';
      const body = { photo: this.handover.photo, condition_notes: this.handover.condition_notes, location_label: this.handover.location_label };
      if (stage === 'pickup') body.fuel_level_percent = this.handover.fuel_level_percent;
      await this.act(action, body);
    },
  },
  template: `
  <div>
    <div class="mb-2"><router-link to="/partner/jobs" class="small strong"><i class="bi bi-arrow-left"></i> All jobs</router-link></div>

    <div v-if="loading" class="stack"><div class="skeleton" style="height:150px"></div><div class="skeleton" style="height:220px"></div></div>
    <div v-else-if="error" class="card"><empty-state icon="bi-exclamation-circle" title="Job not found" :text="error"><router-link to="/partner/jobs" class="btn mt-2">Back to jobs</router-link></empty-state></div>

    <div v-else-if="job">
      <div class="card card-pad">
        <div class="flex between items-start wrap gap-2">
          <div>
            <div class="flex items-center gap-2 wrap"><span class="pill" :class="meta.cls"><i :class="['bi', meta.icon]"></i>{{ meta.label }}</span><span class="mono small muted">{{ job.code }}</span>
              <span v-if="kind === 'valet'" class="pill">{{ requestTypeLabel }}</span></div>
            <div class="job-route mt-2" style="font-size:1.1rem"><i class="bi bi-geo-alt-fill ok-text"></i>{{ job.pickup_label }}<i class="bi bi-arrow-right via"></i>{{ job.drop_label }}</div>
            <div class="small muted mt-1">{{ job.distance_km }} km · requested {{ relTime(job.requested_at, Date.now()) }}</div>
          </div>
          <div class="right" v-if="job.rider">
            <div class="strong">{{ job.rider.username }}</div>
            <div class="small muted" v-if="job.rider.phone">{{ job.rider.phone }}</div>
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

        <div v-if="actionError" class="alert bad mt-2"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>

        <div class="flex wrap gap-1 mt-3">
          <template v-if="kind === 'ride'">
            <button class="btn" v-if="job.actions.can_arriving" :disabled="busy" @click="act('arriving')"><i class="bi bi-signpost-2"></i> Heading to pickup</button>
            <button class="btn" v-if="job.actions.can_arrived" :disabled="busy" @click="act('arrived')"><i class="bi bi-geo-alt-fill"></i> I've arrived</button>
            <button class="btn" v-if="job.actions.can_start" :disabled="busy" @click="act('start')"><i class="bi bi-play-fill"></i> Start ride</button>
            <button class="btn" v-if="job.actions.can_complete" :disabled="busy" @click="act('complete')"><i class="bi bi-flag-fill"></i> Complete ride</button>
            <button class="btn btn-ghost" v-if="job.actions.can_reject" :disabled="busy" @click="act('reject')"><i class="bi bi-arrow-counterclockwise"></i> Back out</button>
          </template>
          <template v-else>
            <button class="btn" v-if="job.actions.can_go_to_pickup" :disabled="busy" @click="act('going-to-pickup')"><i class="bi bi-signpost-2"></i> Heading to pickup</button>
            <button class="btn" v-if="job.actions.can_record_pickup" :disabled="busy" @click="openHandover('pickup')"><i class="bi bi-camera-fill"></i> Record pickup</button>
            <button class="btn" v-if="job.actions.can_in_transit" :disabled="busy" @click="act('in-transit')"><i class="bi bi-car-front-fill"></i> Vehicle in transit</button>
            <button class="btn" v-if="job.actions.can_record_dropoff" :disabled="busy" @click="openHandover('dropoff')"><i class="bi bi-camera-fill"></i> Record drop-off</button>
            <button class="btn" v-if="job.actions.can_complete" :disabled="busy" @click="act('complete')"><i class="bi bi-flag-fill"></i> Complete job</button>
            <button class="btn btn-ghost" v-if="job.actions.can_reject" :disabled="busy" @click="act('reject')"><i class="bi bi-arrow-counterclockwise"></i> Back out</button>
          </template>
          <button class="btn btn-danger-outline" v-if="job.actions.can_cancel" :disabled="busy" @click="openCancel"><i class="bi bi-x-circle"></i> Cancel</button>
        </div>
      </div>

      <!-- ===== fare / fee ===== -->
      <div class="card mt-3" v-if="(kind === 'ride' && job.fare) || (kind === 'valet' && job.fee)">
        <div class="card-head"><h3><i class="bi bi-receipt ok-text"></i> {{ kind === 'ride' ? 'Fare' : 'Fee' }}</h3>
          <span class="pill" :class="(kind === 'ride' ? job.fare.paid : job.paid) ? 'ok' : 'warn'">{{ (kind === 'ride' ? job.fare.paid : job.paid) ? 'Paid by rider' : 'Payment pending' }}</span></div>
        <div class="card-body">
          <template v-if="kind === 'ride'">
            <div class="kv" v-for="(r, i) in fareLine" :key="i"><span>{{ r.l }}</span><span v-if="r.v != null">{{ money(r.v) }}</span></div>
            <div class="kv"><span class="strong" style="color:var(--ink)">Total</span><span style="font-size:1.1rem">{{ money(job.fare.total) }}</span></div>
            <div class="tiny muted mt-1">Your earning (after platform commission) is shown on the Earnings page once paid.</div>
          </template>
          <template v-else>
            <div class="kv" v-if="job.cancellation_fee"><span>Cancellation fee</span><span>{{ money(job.cancellation_fee) }}</span></div>
            <div class="kv"><span class="strong" style="color:var(--ink)">Total</span><span style="font-size:1.1rem">{{ money(job.fee) }}</span></div>
          </template>
        </div>
      </div>

      <!-- ===== handover proof (valet only) ===== -->
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
    <modal v-if="modal === 'cancel' && job" title="Cancel this job?" @close="modal = null">
      <div class="stack">
        <div class="alert warn"><i class="bi bi-exclamation-triangle"></i><div>Cancelling after you've reached the rider/vehicle may attract a cancellation fee, charged to the rider.</div></div>
        <div class="field"><label>Reason (optional)</label><textarea class="textarea" rows="3" v-model="cancelReason" placeholder="Let the rider know why"></textarea></div>
        <div v-if="actionError" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>
      </div>
      <template slot="footer">
        <button class="btn btn-outline" @click="modal = null">Keep job</button>
        <button class="btn btn-danger" :disabled="busy" @click="act('cancel', { reason: cancelReason })"><span v-if="busy" class="spin"></span>Yes, cancel</button>
      </template>
    </modal>

    <!-- ===================== HANDOVER MODAL (pickup / dropoff) ===================== -->
    <modal v-if="(modal === 'pickup' || modal === 'dropoff') && job" :title="modal === 'pickup' ? 'Record pickup handover' : 'Record drop-off handover'" @close="modal = null">
      <div class="stack">
        <photo-picker v-model="handover.photo" label="Vehicle photo" hint="Shows the vehicle's condition at this handover."></photo-picker>
        <div class="field"><label>Location</label><input class="input" v-model="handover.location_label" :placeholder="modal === 'pickup' ? job.pickup_label : job.drop_label"></div>
        <div class="field" v-if="modal === 'pickup'"><label>Fuel level: {{ handover.fuel_level_percent }}%</label>
          <input type="range" min="0" max="100" step="5" v-model.number="handover.fuel_level_percent" style="width:100%"></div>
        <div class="field"><label>Condition notes (optional)</label><textarea class="textarea" rows="2" v-model="handover.condition_notes" placeholder="Any scratches, dents or damage to note"></textarea></div>
        <div v-if="actionError" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ actionError }}</div></div>
      </div>
      <template slot="footer">
        <button class="btn btn-outline" @click="modal = null">Cancel</button>
        <button class="btn" :disabled="busy" @click="submitHandover(modal)"><span v-if="busy" class="spin"></span>Save handover</button>
      </template>
    </modal>
  </div>`,
};
