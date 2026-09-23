import { get } from '../../api.js';
import { session } from '../../session.js';
import { clock, nowMs } from '../../clock.js';
import { money, nextSlotTime, todayKey, addDaysKey } from '../../format.js';
import { BookingCard, LiveBooking, greeting } from '../../components/booking.js';

const DURS = [{ m: 60, l: '1 hour' }, { m: 120, l: '2 hours' }, { m: 180, l: '3 hours' }, { m: 240, l: '4 hours' }, { m: 480, l: '8 hours' }];

export default {
  components: { BookingCard, LiveBooking },
  data() {
    return {
      s: session, clock, loading: true, error: '',
      bookings: [], summary: null, lots: [], sub: null,
      q: { lotId: '', date: '', time: '', dur: 120 }, durs: DURS,
    };
  },
  computed: {
    name() { return this.s.user ? this.s.user.username : ''; },
    hello() { return greeting(this.clock.now); },
    minDate() { return todayKey(this.clock.now); },
    maxDate() { return addDaysKey(this.clock.now, 30); },
    current() {
      // what the driver is doing right now: overstaying > parked > ready-to-check-in > next upcoming
      const order = ['overstay', 'parked', 'ready', 'upcoming'];
      const live = this.bookings.filter(b => order.includes(b.status));
      live.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || Date.parse(a.start_time) - Date.parse(b.start_time));
      return live[0] || null;
    },
    upcoming() {
      return this.bookings.filter(b => ['upcoming', 'ready'].includes(b.status) && (!this.current || b.id !== this.current.id))
        .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time)).slice(0, 3);
    },
    recent() { return this.bookings.filter(b => ['completed', 'cancelled', 'no_show'].includes(b.status)).slice(0, 3); },
    freeMinutes() { return this.sub ? this.sub.welcome_minutes_remaining : 0; },
    planName() { return this.sub && this.sub.subscription ? this.sub.subscription.plan.name : null; },
    topLots() { return this.lots.slice(0, 3); },
  },
  created() {
    const t = nextSlotTime(nowMs());
    this.q.date = t.date; this.q.time = t.time;
    this.load();
    this.$root.$on('clock-changed', this.load);
  },
  beforeDestroy() { this.$root.$off('clock-changed', this.load); },
  methods: {
    money,
    async load() {
      // Each piece is fetched independently (Promise.allSettled, not Promise.all) so that one slow/
      // failing call - e.g. /api/subscription - can't blank out bookings and lots that loaded fine.
      // A retry only needs to be shown for the piece(s) that actually failed.
      const [b, l, sub] = await Promise.allSettled([
        get('/api/bookings'), get('/api/lots', { sort: 'availability' }), get('/api/subscription'),
      ]);
      const problems = [];
      if (b.status === 'fulfilled') { this.bookings = b.value.bookings; this.summary = b.value.summary; }
      else problems.push('your bookings');
      if (l.status === 'fulfilled') {
        this.lots = l.value.lots;
        if (!this.q.lotId && l.value.lots.length) this.q.lotId = l.value.lots[0].id;
      } else problems.push('parking lots');
      if (sub.status === 'fulfilled') { this.sub = sub.value; }
      else problems.push('your plan');
      if (problems.length) {
        const firstReason = [b, l, sub].find(r => r.status === 'rejected');
        const detail = firstReason && firstReason.reason && firstReason.reason.message;
        this.error = `Couldn't load ${problems.join(', ')}.` + (detail ? ' ' + detail : '');
      } else {
        this.error = '';
      }
      this.loading = false;
    },
    search() {
      if (!this.q.lotId) return;
      this.$router.push({ path: '/app/book/' + this.q.lotId, query: { date: this.q.date, time: this.q.time, dur: this.q.dur } });
    },
    pct(l) { return l.availability.total ? Math.round(100 * (l.availability.total - l.availability.free_next_hour) / l.availability.total) : 0; },
  },
  template: `
  <div>
    <section class="welcome">
      <h1>{{ hello }}, {{ name }} 👋</h1>
      <p>Where are you parking today?</p>
      <form class="qsearch" @submit.prevent="search">
        <div><label for="q-lot">Parking lot</label>
          <select id="q-lot" class="select" v-model="q.lotId"><option v-for="l in lots" :key="l.id" :value="l.id">{{ l.name }} · {{ l.city }}</option></select></div>
        <div><label for="q-date">Date</label><input id="q-date" type="date" class="input" v-model="q.date" :min="minDate" :max="maxDate"></div>
        <div><label for="q-time">Arrive</label><input id="q-time" type="time" class="input" v-model="q.time"></div>
        <div><label for="q-dur">For</label>
          <select id="q-dur" class="select" v-model.number="q.dur"><option v-for="d in durs" :key="d.m" :value="d.m">{{ d.l }}</option></select></div>
        <button class="btn btn-lg" :disabled="!q.lotId"><i class="bi bi-grid-3x3-gap"></i> Choose slot</button>
      </form>
    </section>

    <div v-if="error" class="alert bad mt-3"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>

    <div class="stat-cards" v-if="summary">
      <div class="stat-card"><span class="ic blue"><i class="bi bi-calendar-event"></i></span><div><b>{{ summary.upcoming + summary.active }}</b><span>Upcoming & active</span></div></div>
      <div class="stat-card"><span class="ic"><i class="bi bi-wallet2"></i></span><div><b>{{ money(summary.total_spent) }}</b><span>Total spent</span></div></div>
      <div class="stat-card"><span class="ic amber"><i class="bi bi-gift"></i></span><div><b>{{ freeMinutes }} min</b><span>Free allowance left</span></div></div>
      <div :class="['stat-card']" v-if="summary.fines_due > 0"><span class="ic red"><i class="bi bi-cash-coin"></i></span><div><b>{{ money(summary.fines_due) }}</b><span>Fines due</span></div></div>
      <div class="stat-card" v-else><span class="ic"><i class="bi bi-stars"></i></span><div><b>{{ planName || 'No plan' }}</b><span v-if="planName">{{ sub.subscription.remaining_parkings }} free parkings left</span><span v-else><router-link to="/app/plans">See plans</router-link></span></div></div>
    </div>
    <div v-else-if="loading" class="grid grid-4 mt-3"><div v-for="i in 4" :key="i" class="skeleton" style="height:76px"></div></div>

    <div class="two-col">
      <div class="stack">
        <div v-if="current">
          <div class="section-title"><h3>{{ current.status === 'overstay' ? 'Action needed' : current.status === 'parked' ? 'You are parked' : 'Next up' }}</h3></div>
          <live-booking :b="current"></live-booking>
        </div>

        <div>
          <div class="section-title"><h3>Upcoming</h3><router-link to="/app/bookings" class="small strong">All bookings →</router-link></div>
          <div v-if="upcoming.length" class="stack"><booking-card v-for="b in upcoming" :key="b.id" :b="b"></booking-card></div>
          <div v-else-if="!loading" class="card"><empty-state icon="bi-calendar-plus" title="No upcoming bookings" text="Reserve a slot and it will show up here.">
            <router-link to="/app/find" class="btn mt-2">Find parking</router-link></empty-state></div>
        </div>

        <div v-if="recent.length">
          <div class="section-title"><h3>Recent</h3></div>
          <div class="stack"><booking-card v-for="b in recent" :key="b.id" :b="b"></booking-card></div>
        </div>
      </div>

      <aside class="stack">
        <div class="section-title"><h3>Lots with most free slots</h3><router-link to="/app/find" class="small strong">Browse all →</router-link></div>
        <div class="card" v-for="l in topLots" :key="l.id">
          <div class="card-body">
            <div class="flex between gap-2"><div><div class="strong">{{ l.name }}</div><div class="small muted">{{ l.city }} · {{ l.buffer_minutes }} min gap</div></div>
              <div class="right"><b>{{ money(l.price_per_hour) }}</b><div class="tiny muted">per hour</div></div></div>
            <div class="avail mt-2"><span>{{ l.free_now }} / {{ l.availability.total }} free</span><div :class="['progress', pct(l) > 85 ? 'bad' : pct(l) > 60 ? 'warn' : '']"><i :style="{ width: pct(l) + '%' }"></i></div></div>
            <amenity-chips class="mt-2" :amenities="l.amenities" :limit="4"></amenity-chips>
            <router-link :to="'/app/book/' + l.id" class="btn btn-soft btn-block mt-2">Book here</router-link>
          </div>
        </div>

        <div class="card card-pad">
          <h4><i class="bi bi-lightbulb ok-text"></i> Good to know</h4>
          <ul class="small muted" style="padding-left:18px;margin:0">
            <li>Every slot rests for its turnaround gap between bookings.</li>
            <li>Extend from the booking page before your time ends.</li>
            <li>Leaving late costs 1.5× the hourly rate per 15 minutes.</li>
          </ul>
        </div>
      </aside>
    </div>
  </div>`,
};
