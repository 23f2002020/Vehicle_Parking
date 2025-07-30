export default {
  template: `
    <div class="login-page position-relative min-vh-100">
      <div class="background-container">
        <img src="/static/Image1.png" class="background-image" alt="Login Background" />
      </div>

      <div class="container d-flex justify-content-center align-items-center vh-100">
        <div class="glass-box p-4 rounded-4 shadow-lg">
          <h3 class="text-center mb-4 text-white">VParkEasy Login</h3>
          <p class="text-danger text-center">{{ message }}</p>
          
          <form @submit.prevent="login">
            <div class="mb-3">
              <label for="email" class="form-label text-white">Email</label>
              <input type="email" class="form-control" id="email" v-model="formData.email" required>
            </div>
            <div class="mb-3">
              <label for="password" class="form-label text-white">Password</label>
              <input type="password" class="form-control" id="password" v-model="formData.password" required>
            </div>
            <div class="mb-3">
              <label for="loginAs" class="form-label text-white">Login as</label>
              <select class="form-control" id="loginAs" v-model="formData.login_as">
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div class="d-grid mb-3">
              <button class="btn btn-glass" type="submit">Login</button>
            </div>
          </form>

          <div class="text-center">
            <router-link to="/register" class="text-blue">New user? Register</router-link>
          </div>
        </div>
      </div>
    </div>
  `,

  data() {
    return {
      formData: {
        email: '',
        password: '',
        login_as: 'user'      // CHANGED: 'login_as' (DO NOT use userType)
      },
      message: ''
    };
  },

  methods: {
    async login() {
      this.message = '';
      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(this.formData)   // Will have email, password, login_as
        });

        const data = await response.json();

        if (response.ok && data.user && data.user.roles) {
          localStorage.setItem("auth_token", data.user.auth_token);
          localStorage.setItem("user_roles", JSON.stringify(data.user.roles));

          // Use ONLY the chosen role for navigation
          const role = data.user.roles[0];
          if (role === "admin") {
            this.$router.push('/admin/dashboard');
          } else {
            this.$router.push('/dashboard');
          }
        } else {
          this.message = this.formatMessage(data.message || "Login failed");
        }
      } catch (error) {
        this.message = this.formatMessage("An error occurred: " + error.message);
      }
    },

    formatMessage(message) {
      if (!message) return '';
      let formatted = message
        .charAt(0).toUpperCase() + message.slice(1);
      if (!formatted.endsWith('!'))
        formatted += '!';
      return formatted;
    }
  },

  mounted() {
    // Clear any existing auth data
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_roles');
  }
};
