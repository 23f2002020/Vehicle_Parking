"""Rule-based "AI agent" suggestions for the admin Reports page.

There is no external AI/ML service involved (see business rule "no real external
integrations" for the driver domain, which the whole project follows in spirit) - this is a
small, deterministic recommendation engine: a set of readable if/then rules over the numbers
already computed for the report. It is named/framed as an "agent" in the UI because it reads
the admin's own data and proactively suggests actions, but every suggestion below is fully
explainable from the input numbers, which keeps it honest and easy to extend.
"""


def generate_suggestions(lot_perf, slot_rows, kpis):
    """lot_perf: list of per-lot dicts (see AdminReportsResource). slot_rows: list of per-slot
    dicts. kpis: the report's overall KPI dict. Returns a list of {icon, level, title, text},
    ordered roughly by how actionable/urgent they are. `level` is 'critical' | 'warning' | 'tip'."""
    out = []
    earning_lots = [l for l in lot_perf if l["bookings"] > 0]
    # occupancy_pct entries are already percentages (0-100) - average them directly, don't
    # run them through _pct() again (that would treat the sum as a count and inflate it 100x).
    avg_occ = (sum(l["occupancy_pct"] for l in lot_perf) / len(lot_perf)) if lot_perf else 0
    avg_revenue = (sum(l["revenue"] for l in earning_lots) / len(earning_lots)) if earning_lots else 0

    dead_lots = [l for l in lot_perf if l["bookings"] == 0]
    if dead_lots:
        names = ", ".join(l["lot"] for l in dead_lots[:4])
        more = f" and {len(dead_lots) - 4} more" if len(dead_lots) > 4 else ""
        out.append({
            "icon": "bi-exclamation-octagon", "level": "critical",
            "title": f"{len(dead_lots)} lot(s) had zero bookings this period",
            "text": f"{names}{more} did not get a single booking. Double-check the address, "
                    f"photos and hourly rate, and make sure the lot is marked active.",
        })

    weak_lots = [l for l in lot_perf if l["bookings"] > 0 and avg_occ > 0 and l["occupancy_pct"] < avg_occ * 0.5]
    if weak_lots:
        names = ", ".join(l["lot"] for l in weak_lots[:4])
        out.append({
            "icon": "bi-graph-down", "level": "warning",
            "title": f"{len(weak_lots)} lot(s) are running well below your average occupancy",
            "text": f"{names} are filling up at less than half the occupancy of your other lots "
                    f"(avg {round(avg_occ, 1)}%). A short-term price cut, a featured amenity "
                    f"(EV charging, car wash) or a longer free cancellation window can help pull "
                    f"in first-time drivers.",
        })

    high_cancel = [l for l in lot_perf if l["bookings"] >= 5 and l["cancellation_pct"] > 25]
    if high_cancel:
        names = ", ".join(f"{l['lot']} ({l['cancellation_pct']}%)" for l in high_cancel[:4])
        out.append({
            "icon": "bi-x-octagon", "level": "warning",
            "title": "High cancellation rate on some lots",
            "text": f"{names} have more than 1 in 4 bookings cancelled. That is often a sign the "
                    f"slot map, price, or turnaround buffer does not match what drivers expect - "
                    f"worth reviewing the listing details for those lots.",
        })

    if kpis.get("no_show_pct", 0) > 15 and kpis.get("bookings_total", 0) >= 10:
        out.append({
            "icon": "bi-person-x", "level": "warning",
            "title": f"{kpis['no_show_pct']}% of bookings are no-shows",
            "text": "Drivers are reserving slots and never arriving. Consider a small non-refundable "
                    "deposit, or a reminder closer to the start time, to cut down wasted capacity.",
        })

    if earning_lots and avg_revenue > 0:
        stars = [l for l in earning_lots if l["revenue"] >= avg_revenue * 1.5 and l["occupancy_pct"] >= avg_occ]
        if stars and len(earning_lots) > 1:
            top = max(stars, key=lambda l: l["revenue"])
            out.append({
                "icon": "bi-star", "level": "tip",
                "title": f"{top['lot']} is your best performer",
                "text": f"It earns well above the rest of your lots at {top['occupancy_pct']}% occupancy. "
                        f"Whatever is working there (pricing, amenities, location) is worth copying at "
                        f"your weaker lots.",
            })

    low_slots = [s for s in slot_rows if s["utilization_pct"] < 5]
    if len(low_slots) >= 3:
        by_lot = {}
        for s in low_slots:
            by_lot[s["lot"]] = by_lot.get(s["lot"], 0) + 1
        worst_lot = max(by_lot, key=by_lot.get)
        out.append({
            "icon": "bi-grid-3x3-gap", "level": "tip",
            "title": f"{len(low_slots)} individual slots are barely used",
            "text": f"They sit under 5% utilization for the period, {by_lot[worst_lot]} of them in "
                    f"{worst_lot}. If this holds up over a longer window, those bays could be repurposed "
                    f"(EV charging, accessible parking) or the lot's layout trimmed.",
        })

    if kpis.get("avg_occupancy_pct", 0) and kpis["avg_occupancy_pct"] < 25 and kpis.get("bookings_total", 0) >= 5:
        out.append({
            "icon": "bi-megaphone", "level": "tip",
            "title": "Overall occupancy is low across the board",
            "text": f"Average occupancy is only {kpis['avg_occupancy_pct']}% for the period. Beyond "
                    f"individual lots, this usually means it is a visibility problem - promote the "
                    f"lots you'd like to fill first, or run a short introductory discount.",
        })

    if not out:
        out.append({
            "icon": "bi-check-circle", "level": "tip",
            "title": "No major issues detected",
            "text": "Occupancy, cancellations and no-shows are all within a healthy range for this "
                    "period. Keep an eye on the individual lot and slot tables below as new lots ramp up.",
        })
    return out
