// Live board of every bay in one lot: who is parked, what is reserved, gaps and closed slots.
import { get, patch } from '../../api.js';
import { money, dt, timeOnly, range } from '../../format.js';

const TYPES = [{ v: 'standard', l: 'Standard' }, { v: 'ev', l: 'EV charging' }, { v: 'accessible', l: 'Accessible' }, { v: 'compact', l: 'Compact' }];

export default {
  data() { return { loading: true, error: '', lot: null, board: null, picked: null, busy: false, timer: null, types: TYPES }; },
  created() {
    this.load();
    this.timer = setInterval(this.refresh, 20000);
    this.$root.$on('clock-changed', this.refresh);
  },
  beforeDestroy() { clearInterval(this.timer); this.$root.$off('clock-changed', this.refresh); },
  computed: {
    counts() { return this.board ? this.board.counts : {}; },
    slot() {
      if (!this.board || !this.picked) return null;
      for (const f of this.board.floors) { const s = f.slots.find(x => x.id === this.picked); if (s) return Object.assign({ floor: f.floor }, s); }
      return null;
    },
    statusLabel() { return { available: 'Free', occupied: 'Occupied', reserved: 'Reserved', buffer: 'Turnaround gap', blocked: 'Closed', booked: 'Booked' }; },
  },
  methods: {
    money, dt, timeOnly, range,
    async load() {
      try {
        const id = this.$route.params.id;
        const [lot, board] = await Promise.all([get('/api/admin/lots/' + id), get(`/api/admin/lots/${id}/slots`)]);
        this.lot = lot; this.board = board; this.error = '';
      } catch (e) { this.error = e.status === 404 ? 'That lot does not exist (or belongs to another owner).' : e.message; }
      this.loading = false;
    },
    async refresh() {
      if (!this.lot) return;
      try { this.board = await get(`/api/admin/lots/${this.lot.id}/slots`); } catch (e) { /* keep the old board */ }
    },
    async update(patchBody, okMsg) {
      this.busy = true;
      try { await patch('/api/admin/slots/' + this.slot.id, patchBody); this.$toast.success(okMsg); await this.refresh(); this.$root.$emit('admin-changed'); }
      catch (e) { this.$toast.error(e.message); }
      this.busy = false;
    },
    toggleClosed() {
      const closing = this.slot.status !== 'blocked';
      this.update({ is_active: !closing }, closing ? `Slot ${this.slot.full_label} closed` : `Slot ${this.slot.full_label} reopened`);
    },
    setType(e) { this.update({ slot_type: e.target.value }, 'Slot type updated'); },
    openBooking(code) { this.$router.push({ path: '/admin/operations', query: { q: code } }); },
  },
  template: `
  <div>
    <div class="mb-2"><router-link to="/admin/lots" class="small strong"><i class="bi bi-arrow-left"></i> All lots</router-link></div>
    <div v-if="loading" class="skeleton" style="height:400px"></div>
    <div v-else-if="error" class="a-card"><empty-state icon="bi-exclamation-circle" title="Can't open the slot board" :text="error"></empty-state></div>
    <div v-else>
      <div class="a-head">
        <div><h1>{{ lot.name }} <span class="muted" style="font-weight:600;font-size:1rem">· slot board</span></h1><p>{{ lot.number_of_spots }} slots · live view, refreshes every 20 seconds</p></div>
        <div class="flex gap-1 wrap">
          <span class="pill ok">{{ counts.available || 0 }} free</span><span class="pill bad">{{ counts.occupied || 0 }} occupied</span>
          <span class="pill info">{{ counts.reserved || 0 }} reserved</span><span class="pill warn">{{ counts.buffer || 0 }} in gap</span><span class="pill">{{ counts.blocked || 0 }} closed</span>
          <button class="btn btn-sm btn-outline" @click="refresh"><i class="bi bi-arrow-repeat"></i> Refresh</button>
        </div>
      </div>
      <div class="board-grid">
        <slot-map :floors="board.floors" :selected-id="picked" :admin="true" :buffer="board.buffer_minutes" @select="s => picked = s.id"></slot-map>

        <div class="a-card">
          <div class="a-card-head"><h3>{{ slot ? 'Slot ' + slot.full_label : 'Slot details' }}</h3><button v-if="slot" class="icon-btn" @click="picked = null" aria-label="Clear"><i class="bi bi-x-lg"></i></button></div>
          <div class="a-card-body" v-if="!slot"><empty-state icon="bi-hand-index" title="Select a slot" text="Tap any bay to see who is using it, close it for maintenance or change its type."></empty-state></div>
          <div class="a-card-body stack" v-else>
            <div class="flex between items-center"><span class="muted small">Level {{ slot.floor }} · Row {{ slot.row_name }} · Bay {{ slot.col + 1 }}</span>
              <span :class="['pill', slot.status === 'available' ? 'ok' : slot.status === 'occupied' ? 'bad' : slot.status === 'reserved' ? 'info' : slot.status === 'buffer' ? 'warn' : '']">{{ statusLabel[slot.status] }}</span></div>

            <div v-if="slot.occupant" class="occupant">
              <div class="kv"><span>Booking</span><span class="mono">{{ slot.occupant.code }}</span></div>
              <div class="kv"><span>Vehicle</span><span class="mono">{{ slot.occupant.vehicle }}</span></div>
              <div class="kv"><span>Driver</span><span>{{ slot.occupant.user }}</span></div>
              <div class="kv"><span>Time</span><span>{{ range(slot.occupant.start_time, slot.occupant.end_time) }}</span></div>
              <div class="kv"><span>State</span><span>{{ slot.occupant.status }}</span></div>
              <button class="btn btn-sm btn-outline" @click="openBooking(slot.occupant.code)"><i class="bi bi-box-arrow-up-right"></i> Open in operations</button>
            </div>
            <div class="small muted" v-else-if="slot.status === 'buffer'">This slot is resting between two bookings{{ slot.free_from ? ' - free again from ' + timeOnly(slot.free_from) : '' }}.</div>

            <div class="field mb-0"><label>Slot type</label>
              <select class="select" :value="slot.type" @change="setType" :disabled="busy"><option v-for="t in types" :key="t.v" :value="t.v">{{ t.l }}</option></select></div>
            <button :class="['btn btn-block', slot.status === 'blocked' ? '' : 'btn-danger-outline']" :disabled="busy || !!slot.occupant" @click="toggleClosed">
              <i :class="['bi', slot.status === 'blocked' ? 'bi-unlock' : 'bi-slash-circle']"></i> {{ slot.status === 'blocked' ? 'Reopen slot' : 'Close for maintenance' }}</button>
            <div class="hint" v-if="slot.occupant">A slot with an active booking can't be closed. Cancel or finish the booking first.</div>
          </div>
        </div>
      </div>
    </div>
  </div>`,
};
