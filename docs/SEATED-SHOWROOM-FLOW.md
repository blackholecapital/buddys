# Seated Buddy flow

Message Buddy and Video Buddy now share buddy-desk-showroom.png: Buddy smiling at a
counter with the showroom behind him. Message mode stays static and text-only;
video mode opens the existing interactive video connection. Virtual Showroom keeps
the separate standing scene and Coming Soon preview.

The live video element is positioned absolutely inside the stage, sized to its
bounds and explicitly given contain fitting after SDK attachment. This prevents
intrinsic video dimensions from enlarging a grid track and clipping its contents.
It does not reconstruct content already cropped by the provider. Buddy's own
Concierge image reference now uses the same new landscape desk image; the existing
wide fixed-camera prompt remains. Live provider framing still requires acceptance.

The complete release script publishes Pages first so the new avatar URL exists
before the Workers reference it. It then performs the existing guarded Buddy-only
Worker deployments. If Worker preflight/deploy fails, Pages may already be updated;
resolve the reported failure and rerun the complete release.

Artwork generated using the built-in image generation tool from buddy-avatar.jpg
(identity/seated pose) and buddy-show.PNG (background), saved as
apps/frontend/public/buddys/images/buddy-desk-showroom.png.
Prompt: preserve seated Buddy's face, smile, blue polo, both forearms and hands;
place him behind a light wood showroom counter with the existing furniture showroom
behind him, in a fixed medium-wide landscape composition. One Buddy, full head and
hands, generous counter foreground; no UI badges, captions or browser chrome.

Checks: frontend production build, desktop/mobile Chromium message/showroom/video
transitions and full live-element bounds with intrinsic portrait dimensions;
media lifecycle/configuration tests; sealed kit validation and Bash syntax.
