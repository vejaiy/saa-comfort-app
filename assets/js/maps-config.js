/* ============================================================
   SAA Comfort Air LLC — Google Maps configuration for automatic
   mileage calculation (see mileage-db.js).

   SAA_MAPS_API_KEY is intentionally blank until Vijayan supplies one.
   To turn on automatic "Calculate Miles" lookups:
     1. In Google Cloud Console, create (or pick) a project and enable
        the "Maps JavaScript API" and "Distance Matrix API".
     2. Set up billing on that project (Google requires a card on file
        for these APIs, but the free monthly credit comfortably covers
        this app's volume).
     3. Create an API key, then restrict it (Application restrictions ->
        "Websites") to this site's domain so it can't be used elsewhere
        if it ever leaks.
     4. Paste the key below, between the quotes.
   Until a key is set, "Calculate Miles" shows a clear error explaining
   this instead of failing silently — Miles Driven can still always be
   typed in by hand either way.
   ============================================================ */
const SAA_MAPS_API_KEY = "";

/* The fixed starting point for a technician's first leg of any day —
   see ADDRESS in templates.py, which is what's printed on the public
   site's Contact page/footer. Keep these two in sync if the company
   address ever changes. */
const SAA_COMPANY_ADDRESS = "27703 Yorkshire Brook Lane, Fulshear, TX 77441";
