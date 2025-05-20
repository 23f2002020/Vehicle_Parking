from flask import current_app as app, jsonify, request
from flask_security import auth_required, roles_required, current_user, hash_password
from .database import db
from .models import User, Role, ParkingLot, ParkingSpot, Reservation

@app.route('/',methods = ['GET'])
def home():
    return "<h1>Welcome to Vehicle Parking System Home page</h1>"

@app.route('/admin')
@auth_required('token') #authentication
@roles_required('admin') #authorization
def admin():
    return jsonify({
        "message": "Hello Admin! you have successfully logged in"
        })

@app.route('/user')
@auth_required('token') #authentication
@roles_required(['user', 'admin']) #authorization
def user():
    user = current_user
    return jsonify({
        "message": "Hello User! you have successfully logged in",
        "username": user.username,
        "email": user.email,
        "password": user.password
        })

@app.route('/api/register', methods=['POST'])
def create_user():
    credentials = request.get_json()
    if not app.security.datastore.find_user(email =credentials['email']): 
        app.security.datastore.create_user(email = credentials['email'], username= credentials['username'], password = hash_password(credentials['password']), active = True, roles = ['user'])
        db.session.commit()
        return jsonify({
            "message": "User created successfully"
        }), 201
    return jsonify({
            "message": "User already exists!"
        }), 400