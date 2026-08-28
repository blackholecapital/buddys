# Buddy's Demo — Next Pass

## Pass 1 complete

- [x] Copy the complete Alley Concierge snapshot into the dedicated Buddy's repository
- [x] Preserve phone, SMS, email, DocuSign, calendar, dashboard, and voice assets
- [x] Add Live Video as a lead-tile contact method
- [x] Add one-click instant personal-shopper video
- [x] Pass known lead context into the video session
- [x] Route through LiveKit + Buddy-owned video Worker and avatar agent + LemonSlice
- [x] Configure Buddy LemonSlice agent `agent_9f9ee92bbcec14c3`
- [x] Default video voice provider to `eila-runtime`
- [x] Add server-side demo rate guard

## Pass 2 — infrastructure isolation and deployment (in progress)

- [x] Declare Buddy-specific Cloudflare Worker names
- [x] Declare Buddy-specific D1, Queue, and Analytics Engine resources
- [x] Bind Buddy dashboard → concierge → `buddys-video-worker`
- [x] Mirror AI Fans with a LemonSlice `image-url` avatar source
- [x] Point the phone voice worker at `https://alley-voice.xyz-labs.xyz`
- [x] Route browser video to LiveKit agent `lemonslice` with `eila-runtime:buddy`
- [ ] Authenticate Wrangler and provision the declared Cloudflare resources
- [ ] Set matching `INTERNAL_CALL_SECRET` and `BLACKHOLE_CAPABILITY_TOKEN`
- [ ] Set `LEMONSLICE_BUDDYS_API_KEY` on `buddys-video-worker`
- [ ] Start/confirm the RX 6800 LiveKit `lemonslice` worker registration
- [ ] Deploy concierge, dashboard, and frontend in that order
- [ ] Run both entry-path smoke tests from the public Buddy page

## Pass 3 — sales workflow tuning

- [ ] Tune Buddy's video persona and first-turn behavior
- [ ] Add demo catalog tools for furniture, mattresses, appliances, TVs, computers, phones, and gaming
- [ ] Emit product selections from the video worker into `/internal/product-selected`
- [ ] Continue into DocuSign and delivery scheduling without asking the customer to repeat details
- [ ] Add video transcript and session telemetry to the operator dashboard
