# Premium showroom follow-up

The customer workspace now opens below the visible Buddy's masthead. Message Buddy,
Video Buddy and Virtual Showroom share compact controls below the scene. The old
full-width video retry button is hidden; Video Buddy starts or retries video.
Messaging keeps the microphone off. Closing ends the existing session as before.

The supplied showroom reference is included at
`apps/frontend/public/buddys/images/buddy-showroom-reference.png`.
CSS frames the showroom scene from that original image, preserving its proportions;
Message Buddy also uses the standing Buddy in this scene. No new avatar runtime or
3D scene is loaded. The showroom is labelled Coming Soon. The right rail keeps the
existing category selector and live catalog interactions in a compact product card.
Catalog illustrations remain labelled; no reference-image prices become live prices.

The Pages proxy preserves the browser Origin while forwarding to the dashboard
Worker URL. The dashboard config previously allowed only the Pages domains, so the
custom domain could receive `Origin not allowed`. ALLOWED_ORIGINS now also includes
exactly `https://buddys.blackholecapital.xyz`. Other origins remain rejected.

Release requires the named Buddy dashboard Worker configuration and the frontend
Pages build. The existing scripts/deploy-buddy-bindings.py flow deploys the dashboard
and Concierge after its preflight. Build apps/frontend and deploy dist to the buddys
Pages project on main after merging. No secrets need to be replaced.

Validation: frontend build; Chromium at 1280, 390 and 320 pixels including header
clearance, bottom controls, messaging, catalog selection and video failure recovery;
DOM media lifecycle tests; production security suite; sealed adapter validation.
These use fixture providers. Production messaging/video acceptance remains a live
check after deployment, including verifying the custom domain allowlist is active.
