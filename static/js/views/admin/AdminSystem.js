// Health of the background system (Redis, Celery, e-mail) + the business rules in force + the e-mail outbox.
import { get } from '../../api.js';
import { dt } from '../../format.js';

const RULE_LABELS = {
  BUFFER_MINUTES_DEFAULT: ['Default turnaround gap', 'min'], FINE_MULTIPLIER: ['Overstay fine multiplier', '× hourly rate'],
  FINE_GRACE_MINUTES: ['Overstay grace period', 'min'], BILLING_BLOCK_MINUTES: ['Billing block', 'min'],
  MIN_BOOKING_MINUTES: ['Minimum booking', 'min'], MAX_BOOKING_HOURS: ['Maximum booking', 'h'],
  FREE_CANCEL_MINUTES_BEFORE: ['Free cancellation until', 'min before start'], LATE_CANCEL_REFUND_PERCENT: ['Late-cancel refund', '%'],
  WELCOME_FREE_MINUTES: ['Welcome allowance', 'min'], FREE_ADMIN_LOTS: ['Lots on the free owner plan', ''],
};

export default {
  data() { return { loading: true, error: '', s: null, timer: null, ruleLabels: RULE_LABELS }; },
  created() { this.load(); this.timer = setInterval(this.load, 15000); },
  beforeDestroy() { clearInterval(this.timer); },
  computed: {
    mode() {
      const s = this.s; if (!s) return {};
      if (s.task_mode === 'inline' || !s.redis) return { cls: 'warn', title: 'Background threads', text: s.redis ? 'TASK_MODE=inline: jobs run inside the web process.' : 'Redis is not reachable, so e-mails and reminders run inside the web process. Nothing is lost - start Redis + a worker to use Celery.' };
      if (s.celery_workers === 0) return { cls: 'warn', title: 'Redis up, no worker', text: 'Redis is running but no Celery worker answered. Jobs fall back to threads until you start a worker.' };
      return { cls: 'ok', title: `Celery (${s.celery_workers} worker${s.celery_workers > 1 ? 's' : ''})`, text: 'Jobs are queued in Redis and processed by the Celery worker. Beat schedules reminders every 5 minutes.' };
    },
  },
  methods: {
    dt,
    async load() {
      try { this.s = await get('/api/admin/system'); this.error = ''; } catch (e) { this.error = e.message; }
      this.loading = false;
    },
  },
  template: `
  <div>
    <div class="a-head"><div><h1>System & jobs</h1><p>Redis, Celery, e-mail and the rules the platform enforces.</p></div><button class="btn btn-outline btn-sm" @click="load"><i class="bi bi-arrow-repeat"></i> Refresh</button></div>
    <div v-if="error" class="alert bad">{{ error }}</div>
    <div v-if="loading" class="skeleton" style="height:200px"></div>
    <template v-else-if="s">
      <div class="sys-grid">
        <div class="sys-tile"><span :class="['sys-dot', s.redis ? 'ok' : 'warn']"></span><div><b>Redis</b><div class="small muted">{{ s.redis ? 'Connected' : 'Not reachable (optional)' }}</div></div></div>
        <div class="sys-tile"><span :class="['sys-dot', mode.cls]"></span><div><b>{{ mode.title }}</b><div class="small muted">Task mode: <span class="mono">{{ s.task_mode }}</span></div></div></div>
        <div class="sys-tile"><span :class="['sys-dot', s.mail_mode === 'smtp' ? 'ok' : 'warn']"></span><div><b>E-mail: {{ s.mail_mode }}</b><div class="small muted">{{ s.mail_mode === 'smtp' ? 'Sent through your SMTP server' : 'Saved to instance/outbox (no SMTP configured)' }}</div></div></div>
        <div class="sys-tile"><span class="sys-dot ok"></span><div><b>Server time</b><div class="small muted">{{ dt(s.server_time) }} · {{ s.timezone }}<template v-if="s.clock_offset_minutes"> · demo +{{ s.clock_offset_minutes }} min</template></div></div></div>
      </div>
      <div class="alert" :class="mode.cls === 'ok' ? 'ok' : 'warn'"><i class="bi bi-info-circle"></i><div><b>{{ mode.title }}.</b> {{ mode.text }}</div></div>

      <div class="charts-grid even mt-3">
        <div class="a-card"><div class="a-card-head"><h3>Run Redis + Celery</h3></div><div class="a-card-body">
          <div class="small muted mb-1">Three terminals, from the project folder:</div>
          <div class="code-snippet">redis-server
celery -A Applications.celery_worker.celery worker -l info --pool=solo
celery -A Applications.celery_worker.celery beat -l info</div>
          <div class="hint mt-1">--pool=solo is required on Windows. Linux/macOS can drop it.</div></div></div>
        <div class="a-card"><div class="a-card-head"><h3>Rules in force</h3></div><div class="a-card-body">
          <div class="kv" v-for="(v, k) in s.rules" :key="k"><span>{{ ruleLabels[k] ? ruleLabels[k][0] : k }}</span><span>{{ v }} {{ ruleLabels[k] ? ruleLabels[k][1] : '' }}</span></div></div></div>
      </div>

      <div class="a-card"><div class="a-card-head"><h3>E-mail outbox <span class="muted small">(latest {{ s.outbox.length }})</span></h3></div>
        <div class="a-card-body">
          <empty-state v-if="!s.outbox.length" icon="bi-envelope" title="No e-mails yet" text="Booking confirmations and reminders show up here when SMTP is not configured."></empty-state>
          <details class="mail" v-for="m in s.outbox" :key="m.file"><summary><span>{{ m.subject }}</span><span class="muted small">{{ m.to }}</span></summary><pre>{{ m.body }}</pre></details>
        </div></div>
    </template>
  </div>`,
};
