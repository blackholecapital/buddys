# Buddy's Demo — Next Pass

## Pass 1 complete

- [x] Copy the complete Alley Concierge snapshot into the dedicated Buddy's repository
- [x] Preserve phone, SMS, email, DocuSign, calendar, dashboard, and voice assets
- [x] Add Live Video as a lead-tile contact method
- [x] Add one-click instant personal-shopper video
- [x] Pass known lead context into the video session
- [x] Route through LiveKit + shared Black Hole video worker + LemonSlice
- [x] Configure Buddy LemonSlice agent `agent_9f9ee92bbcec14c3`
- [x] Default video voice provider to `eila-runtime`
- [x] Add server-side demo rate guard

## Pass 2 — infrastructure isolation and deployment

- [ ] Provision Buddy-specific Cloudflare Worker names
- [ ] Provision Buddy-specific D1, Queue, and Analytics Engine resources
- [ ] Bind Buddy dashboard → concierge → video services
- [ ] Set matching `INTERNAL_CALL_SECRET` and `BLACKHOLE_CAPABILITY_TOKEN`
- [ ] Point the video worker at the RX 6800 Buddy runtime profile
- [ ] Deploy concierge, dashboard, and frontend in that order
- [ ] Run both entry-path smoke tests from the public Buddy page

## Pass 3 — sales workflow tuning

- [ ] Tune Buddy's video persona and first-turn behavior
- [ ] Add demo catalog tools for furniture, mattresses, appliances, TVs, computers, phones, and gaming
- [ ] Emit product selections from the video worker into `/internal/product-selected`
- [ ] Continue into DocuSign and delivery scheduling without asking the customer to repeat details
- [ ] Add video transcript and session telemetry to the operator dashboard
