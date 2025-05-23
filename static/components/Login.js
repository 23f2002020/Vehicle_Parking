export default{
    template:`
    <div class ="row border">
        <div class="col" style="height:570px;">
            <div class="border mx-auto mt-5" style="height:450px;width:350px;">
                <div>
                    <h2 class="text-center">Login Form</h2>
                    <div>
                        <label for="email">Enter Your Email:</label>
                        <input type="text" id="email" v-model="FormData.email" required>
                    </div>
                    <div>
                        <label for="password">Enter Your Password:</label>
                        <input type="password" id="password" v-model="FormData.password" required>
                    </div>
                    <div>
                        <button class="btn btn-primary" @click="login">Login</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `,
    data:function(){
        return{
            FormData:{
                email:'',
                password:''
            }
        }
    },
    methods:{
        login:function(){
            
            fetch('/api/login',{
                method:'POST',
                headers:{
                    'Content-Type':'application/json'
                },
                body:JSON.stringify(this.FormData)
            })
            .then(response => response.json())
            .then( data => {localStorage.setItem("auth_token",data.user["auth_token"]);
            this.$router.push('/dashboard')
            })
        }
    }
}