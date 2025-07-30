export default {
  template: `
    <div class="payment-bg d-flex flex-column align-items-center justify-content-start min-vh-100 px-3" style="padding-top:3rem;">
      <div class="card payment-panel my-5 animate__animated animate__fadeIn w-100"
           style="max-width: 1100px; min-width:400px; box-shadow:0 12px 48px 0 #a0c9fa60;">
        <div class="card-body p-5">
          <!-- Check if plan is provided, then show payment form; else, show payment history -->
          <div v-if="plan">
            <h1 class="mb-4 text-center fw-bold text-gradient" style="font-size:2.4rem;">Checkout</h1>
            <div class="mb-4 text-center fs-4">
              <span class="mb-2 d-block">You’ve selected</span>
              <span class="bg-gradient-pill fw-bold px-5 py-3 fs-3 shadow-sm">{{ plan.name }}</span>
              <span class="d-block mt-3 text-muted fs-5">Amount: <span class="fw-semibold text-success fs-4">₹{{ plan.amount }}</span></span>
            </div>
            <div class="d-flex justify-content-center mb-5">
              <div class="pay-method-icon"
                   :class="{'pay-method-active': paymentMethod==='card'}"
                   @click="paymentMethod='card'" style="min-width:120px;">
                <i class="bi bi-credit-card-2-front-fill fs-3"></i>
                <div>Card</div>
              </div>
              <div class="pay-method-icon ms-4"
                   :class="{'pay-method-active': paymentMethod==='upi'}"
                   @click="paymentMethod='upi'" style="min-width:120px;">
                <i class="bi bi-upc-scan fs-3"></i>
                <div>UPI</div>
              </div>
            </div>
            <form @submit.prevent="pay" autocomplete="off" class="mb-1 px-2">
              <transition name="fade">
                <div v-if="paymentMethod==='card'" class="rounded card-ui shadow p-4 mb-3 mx-auto w-100" style="max-width:420px;">
                  <div class="d-flex align-items-center mb-3">
                    <i class="bi bi-credit-card fs-3 text-indigo me-2"></i>
                    <span class="fw-medium">Card Details</span>
                  </div>
                  <input type="text" maxlength="19" class="form-control mb-2 card-field" v-model="card.card_number"
                    placeholder="1234 5678 9012 3456" @input="formatCardNumber" required>
                  <span class="small text-danger" v-if="cardNumError">{{ cardNumError }}</span>
                  <input type="text" class="form-control mb-2 card-field" v-model="card.card_name"
                    placeholder="Name on Card" required>
                  <div class="row g-2 mb-2">
                    <div class="col">
                      <input type="text" maxlength="5" class="form-control card-field" v-model="card.expiry"
                        placeholder="MM/YY" required>
                      <span class="small text-danger" v-if="expiryError">{{ expiryError }}</span>
                    </div>
                    <div class="col">
                      <input type="password" maxlength="3" class="form-control card-field" v-model="card.cvv"
                        placeholder="CVV" required>
                      <span class="small text-danger" v-if="cvvError">{{ cvvError }}</span>
                    </div>
                  </div>
                </div>
                <div v-else class="rounded card-ui shadow p-4 mb-3 w-100" style="max-width:420px;">
                  <div class="d-flex align-items-center mb-3">
                    <i class="bi bi-upc fs-3 text-success me-2"></i>
                    <span class="fw-medium">Pay via UPI</span>
                  </div>
                  <input type="text" class="form-control card-field" v-model="upiId"
                    placeholder="yourname@bank" required>
                  <span class="small text-danger" v-if="upiError">{{ upiError }}</span>
                </div>
              </transition>
              <button class="btn btn-lg gradient-btn w-100 mt-3 fs-5 py-3" :disabled="loading">
                <span v-if="!loading">Pay & Subscribe</span>
                <span v-else><span class="spinner-border spinner-border-sm"></span> Processing...</span>
              </button>
            </form>
            <transition name="fade">
              <div v-if="successMsg" class="alert alert-success mt-4 text-center animate__animated animate__fadeInUp py-3 fs-5">
                <i class="bi bi-patch-check-fill fs-2 text-success"></i>
                <div class="fw-bold fs-5">Payment successful!</div>
                <div>{{ successMsg }}</div>
              </div>
            </transition>
          </div>

          <!-- PAYMENTS TABLE -->
          <div v-else>
            <h1 class="mb-4 text-center fw-bold text-gradient" style="font-size:2.4rem;">Your Payments</h1>
            <div class="table-responsive shadow-lg rounded-4">
              <table v-if="payments.length" class="table align-middle bg-white fs-5">
                <thead class="table-light rounded-top">
                  <tr style="height:60px;">
                    <th class="px-4 py-3">Tx ID</th>
                    <th class="px-4 py-3">Date</th>
                    <th class="px-4 py-3">Amount</th>
                    <th class="px-4 py-3">Method</th>
                    <th class="px-4 py-3">Type</th>
                    <th class="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in payments" :key="p.transaction_id || p.id" style="height:60px;">
                    <td class="px-4 py-3">{{ p.transaction_id || p.id }}</td>
                    <td class="px-4 py-3">{{ formatDate(p.timestamp || p.date) }}</td>
                    <td class="px-4 py-3"><span class="fw-bold text-success">₹{{ p.amount }}</span></td>
                    <td class="px-4 py-3">
                      <i v-if="isUPI(p)" class="bi bi-upc"></i>
                      <i v-else-if="isOffline(p)" class="bi bi-building-fill-lock"></i>
                      <i v-else class="bi bi-credit-card"></i>
                      {{ formatMethod(p.method || p.payment_method) }}
                    </td>
                    <td class="px-4 py-3">{{ p.type || p.payment_type || '-' }}</td>
                    <td class="px-4 py-3">
                    
  <span v-if="p.status === 'completed'" class="badge badge-success">Success</span>
  <span v-else-if="p.status === 'pending'" class="badge badge-warning">Pending</span>
  <span v-else-if="p.status === 'failed'" class="badge badge-danger">Failed</span>
  <span v-else class="badge badge-secondary">{{ p.status || 'Other' }}</span>

                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="alert alert-info mt-4 text-center fs-5" style="padding:2rem;">
              <i class="bi bi-credit-card"></i> No payments made yet.
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  data() {
    return {
      plan: null,
      paymentMethod: 'card',
      card: { card_number: '', card_name: '', expiry: '', cvv: '' },
      upiId: '',
      loading: false,
      payments: [],
      subscriptions: [],
      successMsg: '',
      cardNumError: '',
      cvvError: '',
      expiryError: '',
      upiError: ''
    };
  },
  methods: {
    formatCardNumber() {
      let num = this.card.card_number.replace(/\D/g, '').slice(0, 16);
      let parts = [];
      for (let i = 0; i < num.length; i += 4) parts.push(num.substr(i, 4));
      this.card.card_number = parts.join(' ');
    },
    validCard() {
      let val = this.card.card_number.replace(/\s/g, '');
      if (!/^\d{16}$/.test(val)) { this.cardNumError = 'Valid 16-digit card required'; return false; }
      this.cardNumError = ''; return true;
    },
    validCVV() {
      if (!/^\d{3}$/.test(this.card.cvv)) { this.cvvError = 'CVV must be 3 digits'; return false; }
      this.cvvError = ''; return true;
    },
    validExpiry() {
      const now = new Date();
      const [mmStr, yyStr] = this.card.expiry.split('/');
      const mm = parseInt(mmStr, 10), yy = parseInt(yyStr, 10);
      if (!mm || !yy || mm < 1 || mm > 12) { this.expiryError = 'Format MM/YY'; return false; }
      const fullYear = 2000 + yy;
      if (fullYear < now.getFullYear() || (fullYear === now.getFullYear() && mm < (now.getMonth() + 1))) { this.expiryError = 'Card is expired'; return false; }
      this.expiryError = ''; return true;
    },
    validUPI() {
      if (!/^[a-zA-Z0-9_.-]+@[a-zA-Z]{3,}$/.test(this.upiId)) { this.upiError = 'Format: user@bank (bank ≥3 letters)'; return false; }
      this.upiError = ''; return true;
    },
    pay() {
      this.cardNumError = this.cvvError = this.expiryError = this.upiError = '';
      let valid = true;
      if (this.paymentMethod === 'card') {
        if (!this.validCard()) valid = false;
        if (!this.validCVV()) valid = false;
        if (!this.card.card_name) valid = false;
        if (!this.validExpiry()) valid = false;
      } else if (this.paymentMethod === 'upi') {
        if (!this.validUPI()) valid = false;
      }
      if (!valid) return;
      this.loading = true;
      setTimeout(() => {
        fetch('/api/payments', {
          method: 'POST',
          headers: {
            'Authentication-token': localStorage.getItem('auth_token'),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            plan_id: this.plan.plan_id,
            amount: this.plan.amount,
            payment_method: this.paymentMethod,
            payment_type: 'subscription'
          })
        })
        .then(r => r.json())
        .then(data => {
          this.loading = false;
          if (data.message && data.subscription_id) {
            this.successMsg = "Payment successful. Subscription activated!";
            setTimeout(() => {
              this.plan = null;
              this.successMsg = '';
              this.fetchPayments();
              this.fetchUserSubscriptions();
            }, 1600);
          } else {
            alert(data.message || "Payment failed!");
          }
        })
        .catch(() => {
          this.loading = false;
          alert("Payment failed!");
        });
      }, 1200);
    },
    fetchPayments() {
      fetch('/api/user/payments', {
      headers: { 'Authentication-token': localStorage.getItem('auth_token') }
    })
      .then(res => res.json())
      .then(data => {
        this.payments = Array.isArray(data) ? data : (Array.isArray(data.payments) ? data.payments : []);
      })
      .catch(() => { this.payments = []; });
  },
    fetchUserSubscriptions() {
        fetch('/api/user/subscriptions', {
        headers: { 'Authentication-token': localStorage.getItem('auth_token') }
        })
        .then(res => res.json())
        .then(data => {
            this.subscriptions = Array.isArray(data) ? data : [];
        })
        .catch(() => { this.subscriptions = []; });
    },
    formatMethod(method) {
      method = (method || '').toLowerCase();
      if (method === 'upi') return 'UPI';
      if (method === 'offline') return 'Offline';
      return 'Card';
    },
    isUPI(p) {
      const m = (p.method || p.payment_method || '').toLowerCase();
      return m === 'upi';
    },
    isOffline(p) {
      const m = (p.method || p.payment_method || '').toLowerCase();
      return m === 'offline';
    },
    // Main status logic as per your requirement
    isSubscriptionSuccess(p) {
      // True if subscription_id present and a subscription exists with id and status=='active'
      if (p.subscription_id) {
        const sub = this.subscriptions.find(sub => sub.id == p.subscription_id);
        return !!(sub && (sub.status === 'active' || sub.is_active));
      }
      return false;
    },
    isPendingSlot(p) {
      // Is parking/slot transaction, method is offline, and status is pending
      return (p.reservation_id && this.isOffline(p) && (p.status === 'pending' || p.status === 'Pending'));
    },
    isSlotSuccess(p) {
      // Parking, card/upi/online, status completed/success
      return (p.reservation_id && ['card', 'upi', 'credit_card', 'debit_card'].includes((p.method || p.payment_method || '').toLowerCase()) &&
        (p.status === 'completed' || p.status === 'success'));
    },
    isSlotFailed(p) {
      // Parking, card/upi/online, status failed
      return (p.reservation_id && ['card', 'upi', 'credit_card', 'debit_card'].includes((p.method || p.payment_method || '').toLowerCase()) &&
        (p.status === 'failed'));
    },
    formatDate(val) {
      if (!val) return '';
      if (val.length === 10 || val.length === 16) return val;
      try { return new Date(val).toLocaleDateString(); } catch { return val; }
    },
    statusTag(p) {
    // Subscription payment: success if sub is active
    if (p.subscription_id) {
      const sub = this.subscriptions.find(sub => sub.id == p.subscription_id);
      if (sub && (sub.status === 'active' || sub.is_active)) return 'success';
    }
    // Slot/parking payment (has reservation_id)
    const method = (p.method || p.payment_method || '').toLowerCase();
    const status = (p.status || '').toLowerCase();
    if (p.reservation_id) {
      if (method === 'offline') {
        return status === 'pending' ? 'pending' : (status === 'completed' ? 'success' : 'failed');
      }
      if (['card','upi','credit_card','debit_card'].includes(method)) {
        return status === 'completed' || status === 'success' ? 'success' : 'failed';
      }
    }
    return 'failed'; // fallback
  },
  },
  mounted() {
    const query = this.$route.query;
    if (query.plan_id && query.amount && query.name) {
      this.plan = {
        plan_id: query.plan_id,
        amount: query.amount,
        name: query.name,
        duration: query.duration
      };
    }
    this.fetchPayments();
    this.fetchUserSubscriptions();
  }
};
