// Shared bits for the "Book a Ride" / "Request Valet" additions to the USER dashboard. Kept local
// to this folder, like partnerLib.js is to the driver-partner one, so nothing about the existing
// booking/lot pages changes. Status labels/steps/percentages are the same state machine the driver
// partner side already defines - re-imported here rather than redefined, so the two sides can never
// drift out of sync with each other or with driver_service.py.
import { get, post } from '../../api.js';
import { money, relTime } from '../../format.js';
import { rideMeta, valetMeta, ridePct, valetPct, ridePos, valetPos, RIDE_STEPS, VALET_STEPS, REQUEST_TYPE_LABEL,
        isRideActive, isValetActive, RouteMap, LocationPickerMap, LiveRouteMap } from '../partner/partnerLib.js';

export { rideMeta, valetMeta, ridePct, valetPct, ridePos, valetPos, RIDE_STEPS, VALET_STEPS, REQUEST_TYPE_LABEL,
        isRideActive, isValetActive, RouteMap, LocationPickerMap, LiveRouteMap };

// Upfront fare/fee estimate for the request form - see /api/rides/quote, /api/valet/quote in
// driver_service.py. Never throws: on any error (e.g. distance not resolvable yet) it just returns
// null and the caller shows nothing rather than a scary error on a page that hasn't been submitted.
export async function fetchQuote(kind, body) {
  try { return await post(kind === 'ride' ? '/api/rides/quote' : '/api/valet/quote', body); }
  catch (e) { return null; }
}

export const VALET_REQUEST_TYPE_OPTIONS = [
  { v: 'home_to_lot', l: 'Home → Lot', hint: 'Pick me up at home, drop the car at the lot.' },
  { v: 'lot_to_home', l: 'Lot → Home', hint: 'Bring my car from the lot to my home.' },
  { v: 'location_to_lot', l: 'Location → Lot', hint: 'Pick me up somewhere else, drop at the lot.' },
  { v: 'lot_to_location', l: 'Lot → Location', hint: 'Bring my car from the lot to another place.' },
];

// A confirmed, not-yet-checked-out booking is the only kind of reservation that can be linked to a
// ride/valet request (see driver_service.py's _active_reservation_for) - mirrors BookingDetail.js's
// own "live" computed so the entry points only ever appear where the backend would actually accept them.
export const RESERVATION_LINKABLE = ['upcoming', 'ready', 'parked', 'overstay'];

export async function fetchLinkedBooking(reservationId) {
  if (!reservationId) return null;
  try { return await get('/api/bookings/' + reservationId); } catch (e) { return null; }
}

// -------------------------------------------------------------- rider-facing ride/valet card
// Like partnerLib.js's JobCard, but written from the RIDER's point of view: shows the assigned
// driver partner (once one has taken the job) instead of the rider's own name, and never offers an
// Accept button - a rider only ever opens a request to see its status or act on it.
export const RideValetCard = {
  props: { job: { type: Object, required: true }, kind: { type: String, required: true } },
  computed: {
    meta() { return this.kind === 'ride' ? rideMeta(this.job.status) : valetMeta(this.job.status); },
    amount() { return this.kind === 'ride' ? (this.job.fare ? this.job.fare.total : null) : (this.job.fee || null); },
    amountPaid() { return this.kind === 'ride' ? !!(this.job.fare && this.job.fare.paid) : !!this.job.paid; },
    when() {
      const j = this.job;
      return j.completed_at || j.cancelled_at || j.started_at || j.dropped_at || j.in_transit_at
        || j.picked_up_at || j.assigned_at || j.accepted_at || j.requested_at;
    },
    driverName() { return this.job.driver ? this.job.driver.full_name : ''; },
    typeLabel() { return this.job.request_type ? (REQUEST_TYPE_LABEL[this.job.request_type] || this.job.request_type) : ''; },
    to() { return '/app/mobility/' + this.kind + '/' + this.job.id; },
  },
  methods: { money, relTime },
  template: `
  <router-link :to="to" :class="['job-card', 's-' + meta.cls]" style="text-decoration:none">
    <div class="stripe"></div>
    <div class="job-body">
      <div class="job-title">
        <span class="pill" :class="meta.cls"><i :class="['bi', meta.icon]"></i>{{ meta.label }}</span>
        <span class="mono tiny muted">{{ job.code }}</span>
        <span v-if="typeLabel" class="pill">{{ typeLabel }}</span>
      </div>
      <div class="job-route"><i class="bi bi-geo-alt-fill ok-text"></i>{{ job.pickup_label }}<i class="bi bi-arrow-right via"></i>{{ job.drop_label }}</div>
      <div class="job-meta">
        <span v-if="driverName"><i class="bi bi-person-badge"></i>{{ driverName }}</span>
        <span v-else><i class="bi bi-hourglass-split"></i>Looking for a driver partner</span>
        <span><i class="bi bi-signpost-split"></i>{{ job.distance_km }} km</span>
        <span><i class="bi bi-clock"></i>{{ relTime(when, Date.now()) }}</span>
      </div>
    </div>
    <div class="job-side">
      <div class="right">
        <div class="bk-amt" v-if="amount">{{ money(amount) }}<span v-if="amountPaid" class="pill ok tiny ml-1">Paid</span></div>
        <div class="tiny muted" v-else>{{ kind === 'ride' ? 'Fare' : 'Fee' }} on completion</div>
      </div>
      <span class="btn btn-sm btn-outline">Details</span>
    </div>
  </router-link>`,
};

// -------------------------------------------------------------- star rating input
export const StarPicker = {
  props: { value: { type: Number, default: 0 } },
  data() { return { hover: 0 }; },
  methods: {
    pick(n) { this.$emit('input', n); },
  },
  template: `
  <div class="star-pick" @mouseleave="hover = 0">
    <i v-for="n in 5" :key="n" :class="['bi', (hover || value) >= n ? 'bi-star-fill on' : 'bi-star']"
       @mouseenter="hover = n" @click="pick(n)"></i>
  </div>`,
};
