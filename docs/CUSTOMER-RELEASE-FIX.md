# Complete customer release and seated video preview

The previous frontend-only command did not deploy the dashboard catalog or the
Concierge camera instruction. The sofa therefore continued to come from the old
Worker catalog. Use `bash scripts/deploy-buddy-customer.sh` after pulling main;
it builds Pages, runs the existing guarded Buddy Worker deployment, then deploys
Pages. It supports the server's older Python with temporary tomli 1.2.3 and uses
already-loaded Cloudflare credentials. No credential replacement or shared-runtime
change is involved.

Video mode now uses buddy-avatar.jpg as a seated, full-image preview while waiting
for media and on media failure. Message mode keeps standing Buddy, and showroom
mode keeps the uploaded showroom. The video preview uses contain sizing so hands
and countertop remain in view. Live provider framing remains separately subject to
the deployed Concierge prompt; CSS cannot restore content absent from that stream.

Versioned experience.css/showroom.js/video.js references force browsers to request
this matched asset revision. Validate live behavior after the complete deployment.
Local validation: production build, Chromium desktop/mobile customer workflows and
seated video fallback, messaging/media lifecycle, Bash syntax. No production deploy
was executed from the development session.
