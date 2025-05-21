from flask import Flask
from Applications.database import db
from Applications.models import User, Role, ParkingLot, ParkingSpot, Reservation, SubscriptionPlan
from Applications.config import LocalConfig
from Applications.resources import api
from flask_security import Security, SQLAlchemyUserDatastore, hash_password


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
    if not app.security.datastore.find_user(email = 'user@admin.com'):
        app.security.datastore.create_user(email = 'user@admin.com', username='admin', password = hash_password("password"), active = True, roles = ['admin'])

    if not app.security.datastore.find_user(email = 'user@user.com'):
        app.security.datastore.create_user(email = 'user@user.com', username='user1', password = hash_password('password'), active = True, roles = ['user'])
      
    if not SubscriptionPlan.query.first():
        plans = [
            SubscriptionPlan(
                name="1-month",
                duration_days=30,
                price=1299,
                free_parkings=2,
                free_washes=0,
                description="Basic plan with 2 free parkings"
            ),
            SubscriptionPlan(
                name="6-month",
                duration_days=180,
                price=4499,
                free_parkings=15,
                free_washes=3,
                description="Popular plan with 15 parkings and 3 free washes"
            ),
            SubscriptionPlan(
                name="1-year",
                duration_days=365,
                price=9599,
                free_parkings=31,
                free_washes=10,
                description="Best value with 31 parkings and 10 free washes"
            )
        ]
        db.session.add_all(plans)
        db.session.commit()

    db.session.commit()
    
#-->hashed_password = bcrypt(password , salt)

from Applications.routes import *

if __name__ == '__main__':
    app.run(debug=True)  