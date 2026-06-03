Makkah Water Leak Priority Dashboard

Run locally:
1. Start a static server: python3 -m http.server 4173
2. Open http://127.0.0.1:4173/
3. Load the included sample CSV or upload another CSV with the expected columns.

Expected columns include DIAMETER_1, MATERIAL_1, INSTALLDAT, NEW_REL_PR, Class_name, and Name.
The dashboard loads xgboost_leak_model.json in the browser and runs local prediction without sending pipe data to a backend.
The map uses MapLibre GL JS and is constrained to Makkah city bounds, with neighbourhood priority areas coloured green, orange, or red.
Hotel pressure is estimated from neighbourhood names as an input criterion alongside pipe diameter; there is no hotel-fetch button or external hotel API call.
