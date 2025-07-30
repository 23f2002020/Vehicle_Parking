export default {
  template: `
    <div class="container py-5">
      <h2 class="mb-4 text-primary text-center">Choose Your Subscription Plan</h2>

      <div v-if="loading" class="text-center my-5">
        <div class="spinner-border" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>

      <div v-else>
        <div class="row justify-content-center">
          <div 
            class="col-sm-10 col-md-6 col-lg-4 mb-4"
            v-for="plan in plans" :key="plan.id"
          >
            <div class="card h-100 shadow plan-card">
              <div class="card-header bg-gradient-primary text-center">
                <h4 class="fw-bold">{{ plan.name }}</h4>
              </div>
              <div class="card-body text-center">
                <h2 class="display-6 text-primary mb-3">₹{{ plan.price }}</h2>
                <ul class="list-group mb-4">
                  <li class="list-group-item border-0 bg-transparent">{{ plan.description }}</li>
                  <li class="list-group-item border-0 bg-transparent text-secondary">
                    <i class="bi bi-clock"></i> Duration: <strong>{{ plan.duration }}</strong> days
                  </li>
                </ul>
              </div>
              <div class="card-footer bg-white border-0 text-center">
                <button 
                  @click="goToPayment(plan)"
                  class="btn btn-lg btn-outline-primary w-100"
                >
                  Subscribe
                </button>
              </div>
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
   goToPayment(plan) {
   this.$router.push({
    path: '/payment',
    query: {
      plan_id: plan.id,
      amount: plan.price,
      name: plan.name,
      duration: plan.duration
    }
  });
    }
  },
  mounted() {
    this.fetchPlans();
  }
}
