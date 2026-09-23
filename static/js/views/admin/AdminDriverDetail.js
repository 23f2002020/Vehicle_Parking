// One driver partner: profile, KYC decision, vehicle approval, earnings and recent job history.
import { get, post } from '../../api.js';
import { dt, dateOnly, money } from '../../format.js';

const TYPE_LABEL = { ride_captain: 'Ride captain', valet_driver: 'Valet driver' };

export default {
  data() {
    return {
      loading: true, error: '', d: null,
      modal: null,               // 'kyc' | 'status' | { vehicle } | null
      kycDecision: 'APPROVED', reason: '', busy: false, modalErr: '',
    };
  },
  computed: {
    id() { return Number(this.$route.params.id); },
    typeLabel() { return this.d ? (TYPE_LABEL[this.d.driver_type] || this.d.driver_type) : ''; },
    pendingVehicles() { return this.d ? (this.d.vehicles || []).filter(v => v.status === 'PENDING') : []; },
    otherVehicles() { return this.d ? (this.d.vehicles || []).filter(v => v.status !== 'PENDING') : []; },
  },
  created() { this.load(); },
  methods: {
    dt, dateOnly, money,
    async load() {
      try { this.d = await get('/api/admin/drivers/' + this.id); this.error = ''; }
      catch (e) { this.error = e.status === 404 ? 'This driver partner was not found.' : e.message; }
      this.loading = false;
    },
    openKyc() { this.modal = 'kyc'; this.kycDecision = 'APPROVED'; this.reason = ''; this.modalErr = ''; },
    openStatus() { this.modal = 'status'; this.reason = ''; this.modalErr = ''; },
    openVehicle(v, decision) { this.modal = { vehicle: v, decision }; this.reason = ''; this.modalErr = ''; },
    async submitKyc() {
      this.busy = true; this.modalErr = '';
      try {
        const r = await post(`/api/admin/drivers/${this.id}/kyc`, { decision: this.kycDecision, reason: this.reason });
        this.d = Object.assign({}, this.d, r.driver);
        this.$toast.success(r.message); this.modal = null;
      } catch (e) { this.modalErr = e.message; }
      this.busy = false;
    },
    async submitStatus() {
      this.busy = true; this.modalErr = '';
      const status = this.d.account_status === 'active' ? 'suspended' : 'active';
      try {
        const r = await post(`/api/admin/drivers/${this.id}/status`, { status, reason: this.reason });
        this.d = Object.assign({}, this.d, r.driver);
        this.$toast.success(r.message); this.modal = null;
      } catch (e) { this.modalErr = e.message; }
      this.busy = false;
    },
    async submitVehicle() {
      this.busy = true; this.modalErr = '';
      try {
        const r = await post(`/api/admin/driver-vehicles/${this.modal.vehicle.id}/review`, { decision: this.modal.decision, reason: this.reason });
        this.d.vehicles = this.d.vehicles.map(v => (v.id === r.vehicle.id ? r.vehicle : v));
        this.$toast.success(r.message); this.modal = null;
      } catch (e) { this.modalErr = e.message; }
      this.busy = false;
    },
  },
  template: `
  <div>
    <div class="mb-2"><router-link to="/admin/driver-partners" class="small strong"><i class="bi bi-arrow-left"></i> Driver partners</router-link></div>

    <div v-if="loading" class="skeleton" style="height:300px"></div>
    <div v-else-if="error" class="a-card"><empty-state icon="bi-exclamation-circle" title="Not found" :text="error"></empty-state></div>

    <div v-else-if="d">
      <div class="a-head">
        <div><h1>{{ d.full_name }}</h1><p>{{ typeLabel }} partner · {{ d.email }}<template v-if="d.phone"> · {{ d.phone }}</template></p></div>
        <div class="flex gap-1 wrap" v-if="d.can_manage">
          <button class="btn btn-outline btn-sm" @click="openKyc"><i class="bi bi-patch-check"></i> Review KYC</button>
          <button :class="['btn btn-sm', d.account_status === 'active' ? 'btn-danger-outline' : 'btn-soft']" @click="openStatus">{{ d.account_status === 'active' ? 'Suspend' : 'Reactivate' }}</button>
        </div>
      </div>

      <div class="grid grid-3 mb-3">
        <div class="a-card a-card-body"><div class="tiny muted strong">KYC STATUS</div><span class="pill mt-1" :class="{ APPROVED: 'ok', PENDING: 'warn', REJECTED: 'bad', EXPIRED: 'bad' }[d.kyc_status]">{{ d.kyc_status }}</span>
          <div class="tiny bad-text mt-1" v-if="d.kyc_reject_reason">{{ d.kyc_reject_reason }}</div></div>
        <div class="a-card a-card-body"><div class="tiny muted strong">ACCOUNT</div><span class="pill mt-1" :class="d.account_status === 'active' ? 'ok' : 'bad'">{{ d.account_status === 'active' ? 'Active' : 'Suspended' }}</span>
          <div class="tiny bad-text mt-1" v-if="d.suspend_reason">{{ d.suspend_reason }}</div></div>
        <div class="a-card a-card-body"><div class="tiny muted strong">RATING</div><div style="font-size:1.3rem;font-weight:800" class="mt-1">{{ d.rating_average != null ? d.rating_average.toFixed(1) + ' ★' : '—' }}</div><div class="tiny muted">{{ d.rating_count }} rating(s)</div></div>
      </div>

      <div class="grid grid-2" style="align-items:start">
        <div class="stack">
          <div class="a-card">
            <div class="a-card-head"><h3>Profile</h3></div>
            <div class="a-card-body">
              <div class="kv"><span>Date of birth</span><span>{{ d.dob ? dateOnly(d.dob) : '—' }}</span></div>
              <div class="kv"><span>Address</span><span>{{ d.address || '—' }}</span></div>
              <div class="kv"><span>Licence number</span><span class="mono">{{ d.licence_number || '—' }}</span></div>
              <div class="kv"><span>Licence expiry</span><span>{{ d.licence_expiry ? dateOnly(d.licence_expiry) : '—' }}</span></div>
              <div class="kv"><span>Joined</span><span>{{ dateOnly(d.created_at) }}</span></div>
              <div class="mt-2 flex gap-2 wrap">
                <img v-if="d.profile_photo" :src="d.profile_photo" alt="Profile photo" style="width:64px;height:64px;object-fit:cover;border-radius:50%">
                <img v-if="d.licence_document" :src="d.licence_document" alt="Licence document" style="width:100px;height:64px;object-fit:cover;border-radius:10px">
              </div>
            </div>
          </div>

          <div class="a-card" v-if="d.driver_type === 'ride_captain'">
            <div class="a-card-head"><h3>Vehicles</h3></div>
            <div class="a-card-body">
              <div v-if="!d.vehicles.length" class="empty small" style="padding:20px"><i class="bi bi-car-front"></i>No vehicle registered yet.</div>
              <div v-else class="stack">
                <div v-for="v in d.vehicles" :key="v.id" class="flex between items-center wrap gap-2" style="padding:10px 0;border-bottom:1px solid var(--line-2)">
                  <div><span class="mono strong">{{ v.reg_number }}</span> <span class="pill" :class="{ APPROVED: 'ok', PENDING: 'warn', REJECTED: 'bad' }[v.status]">{{ v.status }}</span>
                    <div class="tiny muted">{{ v.manufacturer }} {{ v.model }} · {{ v.year || '—' }}</div></div>
                  <div class="dt-actions" v-if="d.can_manage && v.status === 'PENDING'">
                    <button class="btn btn-xs btn-soft" @click="openVehicle(v, 'APPROVED')">Approve</button>
                    <button class="btn btn-xs btn-danger-outline" @click="openVehicle(v, 'REJECTED')">Reject</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="a-card">
            <div class="a-card-head"><h3>Earnings</h3></div>
            <div class="a-card-body">
              <div class="kv"><span>Total earnings</span><span class="strong">{{ money(d.earnings.total_earnings) }}</span></div>
              <div class="kv"><span>Ride earnings</span><span>{{ money(d.earnings.ride_earnings) }}</span></div>
              <div class="kv"><span>Valet earnings</span><span>{{ money(d.earnings.valet_earnings) }}</span></div>
              <div class="kv"><span>Completed jobs</span><span>{{ d.earnings.completed_rides + d.earnings.completed_valet_jobs }}</span></div>
              <div class="kv"><span>Cancelled jobs</span><span>{{ d.earnings.cancelled_rides + d.earnings.cancelled_valet_jobs }}</span></div>
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="a-card">
            <div class="a-card-head"><h3>Recent rides</h3></div>
            <div class="a-table-wrap" v-if="d.recent_rides.length"><table class="dt">
              <thead><tr><th>Code</th><th>Route</th><th>Status</th><th class="num">Fare</th><th>When</th></tr></thead>
              <tbody><tr v-for="r in d.recent_rides" :key="r.id">
                <td class="mono small">{{ r.code }}</td><td class="small">{{ r.pickup_label }} → {{ r.drop_label }}</td>
                <td><span class="pill">{{ r.status }}</span></td><td class="num">{{ r.fare ? money(r.fare.total) : '—' }}</td>
                <td class="small nowrap">{{ dt(r.requested_at) }}</td>
              </tr></tbody></table></div>
            <div v-else class="empty small" style="padding:20px"><i class="bi bi-inbox"></i>No rides yet.</div>
          </div>

          <div class="a-card" v-if="d.driver_type === 'valet_driver'">
            <div class="a-card-head"><h3>Recent valet jobs</h3></div>
            <div class="a-table-wrap" v-if="d.recent_valet.length"><table class="dt">
              <thead><tr><th>Code</th><th>Route</th><th>Status</th><th class="num">Fee</th><th>When</th></tr></thead>
              <tbody><tr v-for="v in d.recent_valet" :key="v.id">
                <td class="mono small">{{ v.code }}</td><td class="small">{{ v.pickup_label }} → {{ v.drop_label }}</td>
                <td><span class="pill">{{ v.status }}</span></td><td class="num">{{ v.fee ? money(v.fee) : '—' }}</td>
                <td class="small nowrap">{{ dt(v.requested_at) }}</td>
              </tr></tbody></table></div>
            <div v-else class="empty small" style="padding:20px"><i class="bi bi-inbox"></i>No valet jobs yet.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== KYC modal ===== -->
    <modal v-if="modal === 'kyc' && d" title="Review KYC" @close="modal = null">
      <div class="stack">
        <div class="field mb-0"><label>Decision</label>
          <div class="seg"><button type="button" :class="{ active: kycDecision === 'APPROVED' }" @click="kycDecision = 'APPROVED'">Approve</button>
            <button type="button" :class="{ active: kycDecision === 'REJECTED' }" @click="kycDecision = 'REJECTED'">Reject</button>
            <button type="button" :class="{ active: kycDecision === 'EXPIRED' }" @click="kycDecision = 'EXPIRED'">Mark expired</button></div></div>
        <div class="field" v-if="kycDecision !== 'APPROVED'"><label>Reason (shown to the driver partner)</label><input class="input" v-model="reason" placeholder="e.g. Licence photo unreadable"></div>
        <div v-if="modalErr" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ modalErr }}</div></div>
      </div>
      <template slot="footer"><button class="btn btn-outline" @click="modal = null">Cancel</button>
        <button class="btn" :disabled="busy" @click="submitKyc"><span v-if="busy" class="spin"></span>Submit</button></template>
    </modal>

    <!-- ===== suspend/activate modal ===== -->
    <modal v-if="modal === 'status' && d" :title="(d.account_status === 'active' ? 'Suspend ' : 'Reactivate ') + d.full_name + '?'" @close="modal = null">
      <div class="stack">
        <p v-if="d.account_status === 'active'">Suspended driver partners are taken offline and can't accept new jobs until reactivated.</p>
        <p v-else>This driver partner will be able to go online and accept jobs again.</p>
        <div class="field" v-if="d.account_status === 'active'"><label>Reason (shown to the driver partner)</label><input class="input" v-model="reason" placeholder="e.g. Multiple KYC rejections"></div>
        <div v-if="modalErr" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ modalErr }}</div></div>
      </div>
      <template slot="footer"><button class="btn btn-outline" @click="modal = null">Back</button>
        <button :class="['btn', d.account_status === 'active' ? 'btn-danger' : '']" :disabled="busy" @click="submitStatus"><span v-if="busy" class="spin"></span>{{ d.account_status === 'active' ? 'Suspend' : 'Reactivate' }}</button></template>
    </modal>

    <!-- ===== vehicle review modal ===== -->
    <modal v-if="modal && modal.vehicle" :title="(modal.decision === 'APPROVED' ? 'Approve ' : 'Reject ') + modal.vehicle.reg_number + '?'" @close="modal = null">
      <div class="stack">
        <div class="field" v-if="modal.decision === 'REJECTED'"><label>Reason (shown to the driver partner)</label><input class="input" v-model="reason" placeholder="e.g. Insurance expired"></div>
        <div v-else class="muted">This vehicle becomes eligible for the driver partner to go online with.</div>
        <div v-if="modalErr" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ modalErr }}</div></div>
      </div>
      <template slot="footer"><button class="btn btn-outline" @click="modal = null">Cancel</button>
        <button :class="['btn', modal.decision === 'REJECTED' ? 'btn-danger' : '']" :disabled="busy" @click="submitVehicle"><span v-if="busy" class="spin"></span>{{ modal.decision === 'APPROVED' ? 'Approve' : 'Reject' }}</button></template>
    </modal>
  </div>`,
};
