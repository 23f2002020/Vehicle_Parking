export default{
    template:`
    <div class ="row border">
        <div class="col" style="height:570px;">
            <div class="border mx-auto mt-5" style="height:450px;width:350px;">
              {{ userdata.email }}
               {{ userdata.username }}
                {{ userdata.password }} 
            </div>
        </div>
    </div>
    `,
    data: function(){
        return{
            userdata:""
        }
    },

    mounted(){
        fetch('/api/home',{
            method:'GET',
            headers:{
                'Content-Type':'application/json',
                "Authentication-token":localStorage.getItem("auth_token")
            },
        })
        .then(response => response.json())
        .then( data => this.userdata = data)
    }
}