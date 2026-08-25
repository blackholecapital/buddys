(() => {
  const modal = document.getElementById("buddyVideoModal");
  const mount = document.getElementById("buddyVideoMount");
  const status = document.getElementById("buddyVideoStatus");
  const connectButton = document.getElementById("buddyConnectButton");
  const micButton = document.getElementById("buddyMicButton");
  const directButton = document.getElementById("instantVideoButton");
  const closeButton = document.getElementById("closeVideoButton");
  const hangupButton = document.getElementById("buddyHangupButton");

  let room = null;
  let micEnabled = true;
  let pendingContext = { source:"direct" };
  let closing = false;

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function setConnect(label, disabled) {
    connectButton.textContent = label;
    connectButton.disabled = disabled;
  }

  function renderPlaceholder(message) {
    mount.innerHTML = `<div class="video-placeholder">
      <img src="./images/BHF_Logo.webp" alt="" aria-hidden="true">
      <b id="buddyVideoStatus"></b>
      <span>Private browser video room</span>
    </div>`;
    const nextStatus = document.getElementById("buddyVideoStatus");
    if (nextStatus) nextStatus.textContent = message;
  }

  function showVideo(context = {}) {
    pendingContext = { ...pendingContext, ...context };
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setConnect("Start Video Chat", false);
    setStatus(context.contactId ? "Your shopping preferences are ready." : "Ready to connect");
  }

  async function closeVideo() {
    closing = true;
    try {
      if (room) await room.disconnect();
    } catch {}
    room = null;
    closing = false;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    renderPlaceholder("Ready to connect");
    setConnect("Start Video Chat", false);
  }

  async function connectRoom() {
    if (!window.LivekitClient) throw new Error("Live video client did not load");
    setConnect("Connecting…", true);
    setStatus("Creating Buddy's private video room…");

    const response = await fetch("/api/video/session", {
      method:"POST",
      headers:{"content-type":"application/json","accept":"application/json"},
      body:JSON.stringify(pendingContext)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || "Video session failed");

    const livekitUrl = data.livekitUrl || data.url || data.livekit_url;
    const token = data.token || data.accessToken || data.access_token;
    if (!livekitUrl || !token) throw new Error("Video broker returned no LiveKit URL or token");

    const { Room, RoomEvent, Track } = window.LivekitClient;
    if (room) await room.disconnect();

    const nextRoom = new Room({ adaptiveStream:true, dynacast:true });
    room = nextRoom;
    const attached = new Set();

    const attachRemoteTrack = (track, publication, participant) => {
      const sid = publication?.trackSid || track?.sid || `${participant?.identity || "remote"}:${track.kind}`;
      if (attached.has(sid)) return;
      attached.add(sid);

      if (track.kind === Track.Kind.Video) {
        const video = document.createElement("video");
        video.autoplay = true;
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.disablePictureInPicture = true;
        video.disableRemotePlayback = true;
        mount.replaceChildren(video);
        track.attach(video);
      } else if (track.kind === Track.Kind.Audio) {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.style.display = "none";
        document.body.appendChild(audio);
        track.attach(audio);
        if (typeof nextRoom.startAudio === "function") void nextRoom.startAudio().catch(() => {});
      }
    };

    nextRoom.on(RoomEvent.TrackSubscribed, attachRemoteTrack);
    nextRoom.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      if (publication?.trackSid) attached.delete(publication.trackSid);
      track.detach().forEach((node) => node.remove());
    });
    nextRoom.on(RoomEvent.Disconnected, () => {
      if (room === nextRoom) room = null;
      if (closing) return;
      renderPlaceholder("Disconnected");
      setConnect("Start Video Chat", false);
    });

    await nextRoom.connect(livekitUrl, token);
    for (const participant of nextRoom.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.isSubscribed && publication.track) attachRemoteTrack(publication.track, publication, participant);
      }
    }
    await nextRoom.localParticipant.setMicrophoneEnabled(true);
    micEnabled = true;
    micButton.textContent = "🎙";
    setConnect("Connected", true);
    setStatus("Connected to Buddy");
  }

  connectButton.addEventListener("click", async () => {
    try { await connectRoom(); }
    catch (error) {
      renderPlaceholder(error instanceof Error ? error.message : "Video connection failed");
      setConnect("Try Again", false);
    }
  });

  directButton.addEventListener("click", () => {
    showVideo({ source:"direct" });
    connectButton.click();
  });
  window.addEventListener("buddy:video-requested", (event) => {
    showVideo(event.detail || {});
    connectButton.click();
  });
  micButton.addEventListener("click", async () => {
    micEnabled = !micEnabled;
    if (room) await room.localParticipant.setMicrophoneEnabled(micEnabled);
    micButton.textContent = micEnabled ? "🎙" : "🔇";
    micButton.setAttribute("aria-label", micEnabled ? "Mute microphone" : "Unmute microphone");
  });
  closeButton.addEventListener("click", closeVideo);
  hangupButton.addEventListener("click", closeVideo);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeVideo(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.classList.contains("hidden")) closeVideo(); });
})();
