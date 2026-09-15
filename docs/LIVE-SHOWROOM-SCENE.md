# Live showroom scene: activation prerequisite

This pass preserves Showroom when its video control is clicked, during connection,
and after failure. It requests a separate registered assistant; it never falls
back to the seated Buddy. Other formats continue using assistant `buddy`.

## Activation (not completed)

The committed sealed tenant manifest currently declares only `buddy`. Its video
contract selects one stored avatar per assistant and ignores arbitrary image URLs.
The runtime owner must provision a supported second Buddy tenant identity (for
example `buddy-showroom`) through the tenant-kit configuration workflow, retaining
the existing Buddy voice. Upload `apps/frontend/public/buddys/images/buddy-show.PNG`
as that identity's avatar via its supported settings endpoint. Do not overwrite
`buddy`, patch sealed adapter files, or bypass the adapter via the broker.

After that identity is registered, configure `BUDDY_SHOWROOM_ASSISTANT_ID` on
`buddys-dashboard-worker` with the registered ID and deploy the Buddy customer
Pages and Dashboard changes using the existing runbook. Until then, Showroom
keeps its image and chat and reports that animation is not connected.

Acceptance: click video in Showroom, grant microphone access, confirm the real
stream animates the standing Buddy in the same scene. Confirm no camera zoom or
scene change, and that Page video still uses seated Buddy. The supplied motion
prompt requests this framing; real provider behavior still requires this check.

Validation: messaging lifecycle regression, video commerce API integration,
frontend production build, and sealed tenant-kit validation. Tests use media
fixtures and do not establish real provider animation quality.
