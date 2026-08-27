(() => {
  const modal = document.getElementById("buddyVideoModal");
  const mount = document.getElementById("buddyVideoMount");
  const connectButton = document.getElementById("buddyConnectButton");
  const micButton = document.getElementById("buddyMicButton");
  const messageButton = document.getElementById("instantMessageButton");
  const videoButton = document.getElementById("instantVideoButton");
  const closeButton = document.getElementById("closeVideoButton");
  const hangupButton = document.getElementById("buddyHangupButton");
  const chatForm = document.getElementById("buddyChatForm");
  const chatInput = document.getElementById("buddyChatInput");
  const chatStream = document.getElementById("buddyChatStream");
  const chatState = document.getElementById("buddyChatState");
  const resourcePanel = document.getElementById("buddyResourcePanel");
  const resourceList = document.getElementById("buddyResourceList");

  let room = null;
  let sessionPromise = null;
  let micEnabled = false;
  let videoEnabled = false;
  let agentReady = false;
  let closing = false;
  let pendingContext = { source:"direct" };
  let remoteVideoElement = null;
  const remoteAudioElements = new Set();
  const renderedTranscriptions = new Set();
  const sharedUrls = new Set();
  let sessionMeta = { contactId:"", room:"", sessionId:"" };
  let sessionTranscript = [];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function statusNode() {
    return document.getElementById("buddyVideoStatus");
  }

  function setStatus(message) {
    const node = statusNode();
    if (node) node.textContent = message;
  }

  function setChatState(message) {
    if (chatState) chatState.textContent = message;
  }

  function setConnect(label, disabled = false) {
    if (!connectButton) return;
    connectButton.textContent = label;
    connectButton.disabled = disabled;
  }

  function renderPlaceholder(message, detail = "Message now or connect on video when ready") {
    mount.innerHTML = `<div class="video-placeholder">
      <img src="./images/buddy-avatar.jpg" alt="Buddy, your personal shopper">
      <b id="buddyVideoStatus"></b>
      <span></span>
    </div>`;
    const placeholder = mount.querySelector(".video-placeholder");
    placeholder.querySelector("b").textContent = message;
    placeholder.querySelector("span").textContent = detail;
  }

  function resourceLabel(url) {
    const value = url.toLowerCase();
    if (value.includes("docusign")) return "Open DocuSign agreement";
    if (value.includes("calendar") || value.includes("schedule") || value.includes("appointment")) return "Open scheduling link";
    if (value.includes("buddyrents") || value.includes("product") || value.includes("item")) return "View product";
    return "Open shared link";
  }

  function urlsIn(text) {
    return (String(text).match(/https?:\/\/[^\s<>"']+/g) || [])
      .map((url) => url.replace(/[),.;!?]+$/g, ""));
  }

  function addResource(url) {
    if (!url || sharedUrls.has(url)) return;
    sharedUrls.add(url);
    const card = document.createElement("a");
    card.className = "buddy-resource-card";
    card.href = url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    const label = document.createElement("b");
    label.textContent = resourceLabel(url);
    const domain = document.createElement("span");
    try { domain.textContent = new URL(url).hostname; }
    catch { domain.textContent = url; }
    card.append(label, domain);
    resourceList.appendChild(card);
    resourcePanel.classList.remove("hidden");
  }

  function addBubble(text, sender = "buddy") {
    const message = String(text || "").trim();
    if (!message) return;
    const bubble = document.createElement("div");
    bubble.className = `buddy-bubble ${sender}`;
    bubble.textContent = message;
    chatStream.appendChild(bubble);
    chatStream.scrollTop = chatStream.scrollHeight;
    urlsIn(message).forEach(addResource);
  }

  function rememberTranscript(role, text, segmentId = "") {
    const message = String(text || "").trim();
    if (!message) return;
    const id = String(segmentId || `${role}:${Date.now()}:${sessionTranscript.length}`);
    if (sessionTranscript.some((entry) => entry.segmentId === id)) return;
    sessionTranscript.push({
      role:role === "customer" ? "customer" : "buddy",
      text:message.slice(0, 4000),
      segmentId:id.slice(0, 240),
      at:Date.now(),
    });
    if (sessionTranscript.length > 100) sessionTranscript = sessionTranscript.slice(-100);
  }

  async function persistVideoSession(ended = false) {
    if (!sessionMeta.contactId || !sessionMeta.sessionId) return;
    const payload = {
      ...sessionMeta,
      ended,
      messages:sessionTranscript,
      source:pendingContext.source || "buddy-web",
    };
    try {
      const response = await fetch("/api/video/transcript", {
        method:"POST",
        headers:{ "content-type":"application/json", "accept":"application/json" },
        body:JSON.stringify(payload),
        keepalive:ended,
      });
      if (!response.ok) console.warn("Buddy: transcript persistence failed", response.status);
    } catch (error) {
      console.warn("Buddy: transcript persistence failed", error);
    }
  }

  function showWorkspace(context = {}, startVideo = false) {
    pendingContext = { ...pendingContext, ...context };
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (!room) {
      setStatus(context.contactId ? "Your shopping preferences are ready." : "Opening private message room…");
      setChatState("Connecting…");
    }
    if (startVideo) {
      void enableVideo();
    } else {
      void ensureSession().catch((error) => {
        setChatState("Offline");
        setStatus("Buddy could not join");
        addBubble(error instanceof Error ? error.message : "Buddy chat is unavailable.", "system");
      });
      requestAnimationFrame(() => chatInput?.focus({ preventScroll:true }));
    }
  }

  async function waitForAgent(timeoutMs = 25_000) {
    const started = Date.now();
    while (room && !agentReady && Date.now() - started < timeoutMs) {
      if (room.remoteParticipants.size > 0) {
        agentReady = true;
        break;
      }
      await sleep(250);
    }
    return Boolean(room && agentReady);
  }

  function markAgentReady(participant) {
    if (agentReady) return;
    agentReady = true;
    setChatState("Buddy is online");
    setStatus(videoEnabled ? "Buddy joined — video is starting…" : "Buddy is ready to message");
    console.info("Buddy: REMOTE PARTICIPANT", participant?.identity || "agent");
  }

  function attachRemoteTrack(track, publication, participant, Track) {
    const sid = publication?.trackSid || track?.sid || `${participant?.identity || "remote"}:${track.kind}`;
    console.info("Buddy: REMOTE TRACK", { sid, kind:track.kind, participant:participant?.identity });
    markAgentReady(participant);

    if (track.kind === Track.Kind.Video) {
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.disablePictureInPicture = true;
      video.disableRemotePlayback = true;
      video.setAttribute("autoplay", "");
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      track.attach(video);
      remoteVideoElement = video;
      if (videoEnabled) mount.replaceChildren(video);
      return;
    }

    if (track.kind === Track.Kind.Audio) {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.muted = !videoEnabled;
      audio.style.display = "none";
      document.body.appendChild(audio);
      track.attach(audio);
      remoteAudioElements.add(audio);
      if (videoEnabled && typeof room?.startAudio === "function") {
        void room.startAudio().catch(() => {});
      }
    }
  }

  async function connectLiveKit(livekitUrl, token) {
    if (!window.LivekitClient) throw new Error("Live video client did not load");
    const { Room, RoomEvent, Track } = window.LivekitClient;
    const nextRoom = new Room({ adaptiveStream:true, dynacast:true });
    room = nextRoom;

    nextRoom.registerTextStreamHandler("lk.transcription", async (reader, participantInfo) => {
      try {
        const message = String(await reader.readAll()).trim();
        const attributes = reader.info?.attributes || {};
        const isFinal = attributes["lk.transcription_final"];
        const segmentId = attributes["lk.segment_id"] || reader.info?.id || `${participantInfo?.identity || "remote"}:${message}`;
        if (!message || isFinal === "false") return;
        if (renderedTranscriptions.has(segmentId)) return;
        renderedTranscriptions.add(segmentId);
        const role = participantInfo?.identity === nextRoom.localParticipant.identity ? "customer" : "buddy";
        rememberTranscript(role, message, segmentId);
        if (role === "buddy") addBubble(message, "buddy");
      } catch (error) {
        console.warn("Buddy: transcription stream failed", error);
      }
    });

    nextRoom.on(RoomEvent.ParticipantConnected, markAgentReady);
    nextRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.info("Buddy: PARTICIPANT DISCONNECTED", participant.identity);
      if (nextRoom.remoteParticipants.size === 0) {
        agentReady = false;
        setChatState("Buddy disconnected");
        setStatus("Buddy disconnected");
      }
    });
    nextRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      attachRemoteTrack(track, publication, participant, Track);
    });
    nextRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((node) => {
        remoteAudioElements.delete(node);
        if (node === remoteVideoElement) remoteVideoElement = null;
        node.remove();
      });
    });
    nextRoom.on(RoomEvent.Disconnected, () => {
      if (room === nextRoom) room = null;
      sessionPromise = null;
      agentReady = false;
      if (closing) return;
      setChatState("Disconnected");
      renderPlaceholder("Disconnected", "Reconnect to continue messaging or video chat");
      setConnect("Reconnect on Video", false);
    });

    await nextRoom.connect(livekitUrl, token);
    console.info("Buddy: JOINED ROOM", nextRoom.name);

    for (const participant of nextRoom.remoteParticipants.values()) {
      markAgentReady(participant);
      for (const publication of participant.trackPublications.values()) {
        if (publication.isSubscribed && publication.track) {
          attachRemoteTrack(publication.track, publication, participant, Track);
        }
      }
    }
  }

  async function ensureSession() {
    if (room) return room;
    if (sessionPromise) return sessionPromise;

    sessionPromise = (async () => {
      setChatState("Connecting…");
      setStatus("Creating Buddy's private room…");
      const response = await fetch("/api/video/session", {
        method:"POST",
        headers:{ "content-type":"application/json", "accept":"application/json" },
        body:JSON.stringify(pendingContext),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Buddy session failed");
      const livekitUrl = data.livekitUrl || data.url || data.livekit_url;
      const token = data.token || data.accessToken || data.access_token;
      if (!livekitUrl || !token) throw new Error("Video broker returned no LiveKit URL or token");

      sessionTranscript = [];
      sessionMeta = {
        contactId:String(data.contactId || pendingContext.contactId || ""),
        room:String(data.room || ""),
        sessionId:String(data.dispatchId || data.sessionId || data.room || ""),
      };

      await connectLiveKit(livekitUrl, token);
      setChatState("Waiting for Buddy…");
      setStatus("Room connected — waiting for Buddy to join…");

      const ready = await waitForAgent();
      if (!ready) {
        throw new Error("The room opened, but Buddy's avatar worker did not join. Please try again.");
      }
      return room;
    })();

    try {
      return await sessionPromise;
    } catch (error) {
      try { if (room) await room.disconnect(); } catch {}
      room = null;
      sessionPromise = null;
      agentReady = false;
      throw error;
    }
  }

  async function enableVideo() {
    try {
      setConnect("Connecting Video…", true);
      setStatus("Connecting Buddy's live avatar…");
      await ensureSession();
      videoEnabled = true;
      micEnabled = true;
      await room.localParticipant.setMicrophoneEnabled(true);
      micButton.disabled = false;
      micButton.textContent = "🎙";
      remoteAudioElements.forEach((audio) => { audio.muted = false; });
      if (typeof room.startAudio === "function") await room.startAudio().catch(() => {});
      if (remoteVideoElement) mount.replaceChildren(remoteVideoElement);
      else renderPlaceholder("Buddy joined — waiting for video…", "You can keep messaging while the avatar starts");
      setConnect("Video Connected", true);
      setStatus(remoteVideoElement ? "Live with Buddy" : "Buddy joined — waiting for video…");
      setChatState("Live video connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video connection failed";
      renderPlaceholder("Buddy did not join", message);
      setChatState("Connection failed");
      setConnect("Try Video Again", false);
      addBubble(message, "system");
    }
  }

  async function closeWorkspace() {
    closing = true;
    await persistVideoSession(true);
    try { if (room) await room.disconnect(); } catch {}
    room = null;
    sessionPromise = null;
    agentReady = false;
    videoEnabled = false;
    micEnabled = false;
    remoteVideoElement = null;
    remoteAudioElements.forEach((node) => node.remove());
    remoteAudioElements.clear();
    sessionMeta = { contactId:"", room:"", sessionId:"" };
    sessionTranscript = [];
    closing = false;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    renderPlaceholder("Ready to message Buddy");
    setChatState("Start a new conversation");
    setConnect("Connect on Video", false);
    micButton.disabled = true;
  }

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = String(chatInput.value || "").trim();
    if (!text) return;
    addBubble(text, "user");
    chatInput.value = "";
    chatInput.disabled = true;
    try {
      await ensureSession();
      await room.localParticipant.sendText(text, { topic:"lk.chat" });
      rememberTranscript("customer", text);
    } catch (error) {
      addBubble(error instanceof Error ? error.message : "Buddy messaging is unavailable.", "system");
    } finally {
      chatInput.disabled = false;
      chatInput.focus();
    }
  });

  messageButton.addEventListener("click", () => showWorkspace({ source:"direct-message" }, false));
  videoButton.addEventListener("click", () => showWorkspace({ source:"direct-video" }, true));
  connectButton.addEventListener("click", enableVideo);
  window.addEventListener("buddy:video-requested", (event) => showWorkspace(event.detail || {}, true));

  micButton.addEventListener("click", async () => {
    micEnabled = !micEnabled;
    if (room) await room.localParticipant.setMicrophoneEnabled(micEnabled);
    micButton.textContent = micEnabled ? "🎙" : "🔇";
    micButton.setAttribute("aria-label", micEnabled ? "Mute microphone" : "Unmute microphone");
  });

  window.addEventListener("pagehide", () => {
    if (room && sessionMeta.contactId) void persistVideoSession(true);
  });

  closeButton.addEventListener("click", closeWorkspace);
  hangupButton.addEventListener("click", closeWorkspace);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeWorkspace(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) closeWorkspace();
  });
})();