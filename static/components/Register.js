export default {
  template: `
  <div class="register-page position-relative min-vh-100">
    <!-- Blur Background -->
    <div class="blur-background"></div>
    
    <!-- Logo Image (same as login) -->
    <img src="/static/image1.png" alt="VParkEasy Logo" class="background-image">
    
    <!-- Registration Form -->
    <div class="container d-flex justify-content-center align-items-center vh-100">
      <div class="card p-4 shadow-lg animated fadeInUp" style="width: 400px; background-color: rgba(255, 255, 255, 0.85); backdrop-filter: blur(5px);">
        <h3 class="text-center mb-4">VParkEasy Registration</h3>
        <p class="text-danger text-center">{{ message }}</p>
        
        <form @submit.prevent="register">
          <div class="mb-3">
            <label for="username" class="form-label">Username</label>
            <input type="text" class="form-control" id="username" v-model="formData.username" required>
          </div>
          <div class="mb-3">
            <label for="email" class="form-label">Email</label>
            <input type="email" class="form-control" id="email" v-model="formData.email" required>
          </div>
          <div class="mb-3">
            <label for="password" class="form-label">Password</label>
            <input type="password" class="form-control" id="password" v-model="formData.password" required>
          </div>
          <div class="mb-3">
            <label for="confirmPassword" class="form-label">Confirm Password</label>
            <input type="password" class="form-control" id="confirmPassword" v-model="formData.confirmPassword" required>
          </div>
          
          <div class="d-grid mb-2">
            <button class="btn btn-primary" type="submit">Register</button>
          </div>
        </form>
        
        <div class="text-center mt-2">
          <router-link to="/login">Already have an account? Login</router-link>
        </div>
      </div>
    </div>
  </div>
  `,
  data() {
    return {
      formData: {
        username: '',
        email: '',
        password: '',
        confirmPassword: ''
      },
      message: ''
    }
  },
  methods: {
    register() {
      if (this.formData.password !== this.formData.confirmPassword) {
        this.message = "Passwords don't match";
        return;
      }
      
      fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: this.formData.username,
          email: this.formData.email,
          password: this.formData.password
        })
      })
      .then(response => response.json())
      .then(data => {
        if (data.message === "User created successfully") {
          this.$router.push('/login');
        } else {
          this.message = data.message || "Registration failed";
        }
      })
      .catch(error => {
        this.message = "An error occurred during registration";
      });
    }
  }
};