from flask_restful import Api, Resource, reqparse
from .models import *
from flask import jsonify, request
from flask_security import auth_required, roles_required, current_user, roles_accepted

api = Api()

class ParkingLotResource(Resource):
    @auth_required('token')
    @roles_accepted('admin', 'user')
    def get(self):
        lots = ParkingLot.query.all()
        if not lots:
            return {"message": "No parking lots available at the moment"}, 404

        lots_json = []
        for lot in lots:
            lot_data = {
                "id": lot.id,
                "name": lot.name,
                "address": lot.address,
                "pin_code": lot.pin_code,
                "price_per_hour": lot.price_per_hour,
                "number_of_spots": lot.number_of_spots,
                "created_at": lot.created_at.strftime('%Y-%m-%d %H:%M:%S') if lot.created_at else None
            }
            lots_json.append(lot_data)
        return lots_json, 200
    
    @auth_required('token')
    @roles_required('admin')
    def post(self):
        data = request.json
        lot = ParkingLot(
            name=data['name'],
            address=data['address'],
            pin_code=data['pin_code'],
            price_per_hour=data['price_per_hour'],
            number_of_spots=data['number_of_spots']
        )
        db.session.add(lot)
        db.session.commit()
        return {"message": "Parking lot created successfully"}, 201

api.add_resource(ParkingLotResource, '/api/parking_lots', endpoint='parking_lots')