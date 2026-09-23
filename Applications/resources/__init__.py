"""All REST endpoints, registered on a single JSON-only Api object.

    Public          GET  /api/health  /api/time  /api/public/overview      POST /api/register /api/login
    Driver          /api/lots  /api/lots/<id>/slot-map  /api/bookings/...  /api/payments  /api/plans  /api/subscription
                    /api/rides/...  /api/valet/...  (the "Book a Ride"/"Request Valet" additions)
    Admin           /api/admin/...
    Driver partner  /api/driver/...  (register/login is the same /api/login as everyone else, with
                    login_as: 'driver' - see resources/driver.py; "driver partner" = ride captain/valet
                    driver, kept apart in wording from the "Driver" role above, which is the parking customer)
"""
from .admin import (AdminBookingActionResource, AdminBookingsResource, AdminDriverKycResource,
                    AdminDriverResource, AdminDriverRevenueResource, AdminDriverStatusResource,
                    AdminDriverVehicleReviewResource, AdminDriversResource, AdminLotResource, AdminLotsResource,
                    AdminOverviewResource, AdminPlanResource, AdminPlansResource, AdminReportsResource,
                    AdminRidesResource, AdminSlotResource, AdminSlotsResource, AdminSystemResource,
                    AdminTransactionsResource, AdminUserResource, AdminUsersResource, AdminValetJobsResource)
from .auth import (DemoClockResource, HealthResource, LoginResource, LogoutResource, MeResource, ProfileResource,
                   RegisterResource, TimeResource)
from .base import JsonApi
from .bookings import (BookingActionResource, BookingResource, BookingsResource, PaymentsResource,
                       QuoteResource)
from .driver import (DriverAvailabilityResource, DriverEarningsResource, DriverKycResource,
                     DriverMeResource, DriverNotificationsResource, DriverRatingsResource,
                     DriverRegisterResource, DriverRideActionResource, DriverRidesResource,
                     DriverValetActionResource, DriverValetResource, DriverVehicleResource)
from .lots import LotResource, LotsResource, PublicLotsResource, SlotMapResource
from .mobility import (RideActionResource, RideQuoteResource, RideResource, RidesResource,
                       ValetActionResource, ValetQuoteResource, ValetRequestResource, ValetRequestsResource)
from .plans import MySubscriptionResource, PlansResource
from .public import PublicOverviewResource

api = JsonApi()

# ---- public
api.add_resource(HealthResource, "/api/health")
api.add_resource(TimeResource, "/api/time")
api.add_resource(PublicOverviewResource, "/api/public/overview")
api.add_resource(RegisterResource, "/api/register")
api.add_resource(LoginResource, "/api/login")
api.add_resource(DriverRegisterResource, "/api/driver/register")   # driver-PARTNER sign-up (separate form, see docstring)
# ---- any signed-in account
api.add_resource(LogoutResource, "/api/logout")
api.add_resource(MeResource, "/api/me")
api.add_resource(ProfileResource, "/api/profile")
api.add_resource(DemoClockResource, "/api/demo/clock")
api.add_resource(PlansResource, "/api/plans")
api.add_resource(MySubscriptionResource, "/api/subscription")
# ---- driver (parking customer)
api.add_resource(LotsResource, "/api/lots")
api.add_resource(LotResource, "/api/lots/<int:lot_id>")
api.add_resource(SlotMapResource, "/api/lots/<int:lot_id>/slot-map")
api.add_resource(QuoteResource, "/api/bookings/quote")
api.add_resource(BookingsResource, "/api/bookings")
api.add_resource(BookingResource, "/api/bookings/<int:booking_id>")
api.add_resource(BookingActionResource, "/api/bookings/<int:booking_id>/<string:action>")
api.add_resource(PaymentsResource, "/api/payments")
# ---- driver (parking customer): Book a Ride / Request Valet, from the User Dashboard
api.add_resource(RideQuoteResource, "/api/rides/quote")
api.add_resource(RidesResource, "/api/rides")
api.add_resource(RideResource, "/api/rides/<int:ride_id>")
api.add_resource(RideActionResource, "/api/rides/<int:ride_id>/<string:action>")
api.add_resource(ValetQuoteResource, "/api/valet/quote")
api.add_resource(ValetRequestsResource, "/api/valet")
api.add_resource(ValetRequestResource, "/api/valet/<int:valet_id>")
api.add_resource(ValetActionResource, "/api/valet/<int:valet_id>/<string:action>")
# ---- driver PARTNER (ride captain / valet driver) dashboard
api.add_resource(DriverMeResource, "/api/driver/me")
api.add_resource(DriverKycResource, "/api/driver/kyc")
api.add_resource(DriverVehicleResource, "/api/driver/vehicle")
api.add_resource(DriverAvailabilityResource, "/api/driver/availability")
api.add_resource(DriverRidesResource, "/api/driver/rides")
api.add_resource(DriverRideActionResource, "/api/driver/rides/<int:ride_id>/<string:action>")
api.add_resource(DriverValetResource, "/api/driver/valet")
api.add_resource(DriverValetActionResource, "/api/driver/valet/<int:valet_id>/<string:action>")
api.add_resource(DriverEarningsResource, "/api/driver/earnings")
api.add_resource(DriverRatingsResource, "/api/driver/ratings")
api.add_resource(DriverNotificationsResource, "/api/driver/notifications")
# ---- admin
api.add_resource(AdminOverviewResource, "/api/admin/overview")
api.add_resource(AdminReportsResource, "/api/admin/reports")
api.add_resource(AdminLotsResource, "/api/admin/lots")
api.add_resource(AdminLotResource, "/api/admin/lots/<int:lot_id>")
api.add_resource(AdminSlotsResource, "/api/admin/lots/<int:lot_id>/slots")
api.add_resource(AdminSlotResource, "/api/admin/slots/<int:slot_id>")
api.add_resource(AdminBookingsResource, "/api/admin/bookings")
api.add_resource(AdminBookingActionResource, "/api/admin/bookings/<int:booking_id>/<string:action>")
api.add_resource(AdminUsersResource, "/api/admin/users")
api.add_resource(AdminUserResource, "/api/admin/users/<int:user_id>")
api.add_resource(AdminTransactionsResource, "/api/admin/transactions")
api.add_resource(AdminPlansResource, "/api/admin/plans")
api.add_resource(AdminPlanResource, "/api/admin/plans/<int:plan_id>")
api.add_resource(AdminSystemResource, "/api/admin/system")
# ---- admin: driver-partner management (platform-wide, see admin.py's driver partners section)
api.add_resource(AdminDriversResource, "/api/admin/drivers")
api.add_resource(AdminDriverResource, "/api/admin/drivers/<int:driver_id>")
api.add_resource(AdminDriverKycResource, "/api/admin/drivers/<int:driver_id>/kyc")
api.add_resource(AdminDriverStatusResource, "/api/admin/drivers/<int:driver_id>/status")
api.add_resource(AdminDriverVehicleReviewResource, "/api/admin/driver-vehicles/<int:vehicle_id>/review")
api.add_resource(AdminRidesResource, "/api/admin/rides")
api.add_resource(AdminValetJobsResource, "/api/admin/valet")
api.add_resource(AdminDriverRevenueResource, "/api/admin/driver-revenue")
