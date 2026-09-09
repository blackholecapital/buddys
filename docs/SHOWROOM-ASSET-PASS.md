# Showroom images and featured sofa

Use the owner's existing `buddy-show.PNG` directly for the standing showroom preview.
Use `couch.PNG` for the Harris 2-Piece Sectional demo card. The sectional retains its
existing product ID, is featured by default for living-room browsing, and includes
four supplied feature bullets and the supplied $799.99 example price labelled Demo
price. Actual price remains null in the commerce contract pending store confirmation.
The other living-room option and all category/selection workflows remain available.

Quick Help fills a relevant question in the chat composer for delivery, payment
options or another question. The customer sends it. Find a Store opens the existing
Buddy's store locator. Product URLs and image paths remain restricted.

Video displays the full returned frame with contain sizing and a little breathing
room. Buddy's own Concierge avatar prompt now requests a fixed wide waist-up view,
including both forearms, hands and countertop, without close-ups or camera zoom.
The shared runtime is unchanged. A live provider session must confirm that framing;
CSS cannot recover parts already cropped out of a provider's stream.

Validation: production frontend build, Chromium 1280/390/320px including the actual
image path and four features, help composer, product selection and video fallback;
message/media lifecycle, video configuration, full commerce workflow and sealed kit.
Provider tests use fixtures. Deploy the Buddy dashboard (catalog), Concierge (avatar
prompt) and Pages (images/UI) through the existing Buddy deployment flow after merge.
