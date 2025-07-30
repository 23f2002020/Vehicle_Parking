export default {
  template: `
  <div v-if="!hideHeader">
  

    <div class="container-fluid bg-white border-bottom py-2 px-4">
      <div class="d-flex justify-content-between align-items-center">
        <!-- Brand Title -->
        <div class="fs-2 fw-bold text-primary">
          VParkEasy
        </div>

        <!-- Top-right Buttons -->
        <div class="d-flex gap-2">
          <router-link class="btn btn-outline-primary" to="/login">Login</router-link>
          <router-link class="btn btn-outline-warning" to="/register">Register</router-link>
        </div>
      </div>
    </div>
</div>
  `
}
