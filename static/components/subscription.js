// subscriptions.js
export default {
  template: `
    <div class="container mt-4">
      <h2 class="mb-4">Subscription Plans</h2>
      
      <div v-if="loading" class="text-center">
        <div class="spinner-border" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>
      
      <div v-else class="row">
        <div class="col-md-4 mb-4" v-for="plan in plans" :key="plan.id">
          <div class="card h-100">
            <div class="card-header bg-primary text-white">
              <h4>{{ plan.name }}</h4>
            </div>
            <div class="card-body">
              <h2 class="card-title pricing-card-title">₹{{ plan.price }}</h2>
              <ul class="list-unstyled mt-3 mb-4">
                <li>{{ plan.description }}</li>
                <li>Duration: {{ plan.duration }} days</li>
              </ul>
            </div>
            <div class="card-footer">
              <button @click="subscribe(plan.id)" class="btn btn-lg btn-primary w-100">
                Subscribe
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,

  data() {
    return {
      plans: [],
      loading: true
    };
  },

  methods: {
    fetchPlans() {
      fetch('/api/subscriptions', {
        headers: { 'Authentication-token': localStorage.getItem('auth_token') }
      })
        .then(res => res.json())
        .then(data => {
          this.plans = data;
          this.loading = false;
        })
        .catch(() => {
          this.loading = false;
        });
    },

    subscribe(planId) {
      this.$router.push(`/payment?plan_id=${planId}`);
    }
  },

  mounted() {
    this.fetchPlans();
  }
};