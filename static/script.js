import Home from './components/Home.js'
import Login from './components/Login.js'
import Register from './components/Register.js'
import NavBar from './components/Navbar.js'
import Footer from './components/footer.js'
import dashboard from './components/dashboard.js'


const routes = [
    {path: '/',component: Home},
    {path: '/login',component: Login},
    {path: '/register',component: Register},
    {path: '/dashboard',component: dashboard}
]

const router = new VueRouter({
    routes
})

const app = new Vue({
    el: '#app',
    router,
    components: {
        'nav-bar': NavBar,
        'foot': Footer
    },
    template: `<div class="container">
    <nav-bar></nav-bar>
    <router-view></router-view>
    <foot></foot>
    </div>`,
     data: {
        section:"Frontend"
    }

})