from flask import Flask, send_from_directory
from Applications.database import db
from Applications.models import User, Role, ParkingLot, ParkingSpot, Reservation, SubscriptionPlan, Admin
from Applications.config import LocalConfig
from Applications.resources import api
from flask_security import Security, SQLAlchemyUserDatastore
from werkzeug.security import generate_password_hash

def create_app():
    app = Flask(__name__)
    app.config.from_object(LocalConfig)
    db.init_app(app)
    api.init_app(app)
    datastore = SQLAlchemyUserDatastore(db, User, Role)
    app.security = Security(app, datastore)
    app.app_context().push()
    return app

app = create_app()

with app.app_context():
    db.create_all()
    app.security.datastore.find_or_create_role(name='admin', description='Administrator')
    app.security.datastore.find_or_create_role(name='user', description='User')
    db.session.commit()

    from Applications.models import ParkingLot
    for lot in ParkingLot.query.all():
        lot.initialize_slots()


    if not Admin.query.filter_by(email='user@admin.com').first():
        admin = Admin(
            username='admin',
            email='user@admin.com',
            password_hash=generate_password_hash("password")
        )
        db.session.add(admin)

    if not app.security.datastore.find_user(email='user@user.com'):
        app.security.datastore.create_user(
            email='user@user.com',
            username='user1',
            password=generate_password_hash('password'),
            active=True,
            roles=['user']
        )

    
        if not SubscriptionPlan.query.first():
            user_plans = [
                SubscriptionPlan(
                    name="1-month Free Roam",
                    plan_type="user",
                    billing_interval="monthly",
                    duration_days=30,
                    price=1299,
                    free_parkings=2,
                    free_washes=0,
                    currency='INR',
                    description="Basic plan with 2 free parkings"
                ),
                SubscriptionPlan(
                    name="6-month Commuter Pro",
                    plan_type="user",
                    billing_interval="monthly",
                    duration_days=180,
                    price=4499,
                    free_parkings=15,
                    free_washes=3,
                    currency='INR',
                    description="Popular plan with 15 parkings and 3 free washes"
                ),
                SubscriptionPlan(
                    name="1-year Elite Parker",
                    plan_type="user",
                    billing_interval="annually",
                    duration_days=365,
                    price=9599,
                    free_parkings=31,
                    free_washes=10,
                    currency='INR',
                    description="Best value with 31 parkings and 10 free washes"
                )
            ]
            
            admin_plans = [   
            SubscriptionPlan(
                name="Admin Basic",
                plan_type="admin",
                billing_interval="monthly",
                duration_days=30,
                price=1999,
                max_spots=5,        # max number of lots or spots for admin
                currency='INR',
                description="Allows up to 5 parking lots/spots"
            ),
            SubscriptionPlan(
                name="Admin Pro",
                plan_type="admin",
                billing_interval="monthly",
                duration_days=30,
                price=4999,
                max_spots=20,
                currency='INR',
                description="Allows up to 20 parking lots/spots"
            ),
            SubscriptionPlan(
                name="Admin Unlimited",
                plan_type="admin",
                billing_interval="annually",
                duration_days=365,
                price=14999,
                max_spots=None,    # Unlimited
                currency='INR',
                description="Unlimited parking lot/spots for 1 year"
            )
        ]

        
        db.session.add_all(user_plans + admin_plans)
        db.session.commit()

@app.route('/static/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory('static/uploads', filename)

# Register blueprint AFTER app is created and initialized
from Applications.routes import routes_bp
app.register_blueprint(routes_bp)

if __name__ == '__main__':
    app.run(debug=True)
