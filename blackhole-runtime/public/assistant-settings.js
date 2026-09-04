const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const WAV_TYPES = new Set(["audio/wav", "audio/x-wav", "audio/wave"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_WAV_BYTES = 25 * 1024 * 1024;

function writeAscii(view, offset, value) {
  [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
}

function encodeMonoPcm16Wav(samples, sampleRate = 24_000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

async function normalizeVoiceReference(file) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  const OfflineContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineContextClass) throw new Error("This browser cannot normalize audio files");
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < 4 || decoded.duration > 60) {
      throw new Error("Voice reference must be between 4 and 60 seconds");
    }
    const frameCount = Math.ceil(decoded.duration * 24_000);
    const offline = new OfflineContextClass(1, frameCount, 24_000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const wav = encodeMonoPcm16Wav(rendered.getChannelData(0), 24_000);
    return new File([wav], `${file.name.replace(/\.wav$/i, "") || "voice-reference"}-24khz.wav`, { type: "audio/wav" });
  } catch (error) {
    throw new Error(`Voice reference could not be normalized: ${error.message}`);
  } finally {
    await context.close().catch(() => {});
  }
}

class BlackholeAssistantSettings extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { color-scheme: dark; display:block; font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif; color:#eaf2ff; }
        * { box-sizing:border-box; }
        form { display:grid; gap:16px; padding:20px; border:1px solid #263753; border-radius:16px; background:#0b1220; }
        header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        h2 { margin:0; font-size:1.05rem; }
        .id { color:#8294ae; font:12px ui-monospace,monospace; }
        .fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; }
        label { display:grid; gap:7px; font-weight:700; }
        small { color:#91a3bd; font-weight:400; }
        input { width:100%; padding:11px; border:1px solid #324563; border-radius:10px; background:#101a2b; color:inherit; }
        input:focus { outline:2px solid #45d6ff; outline-offset:2px; }
        button { justify-self:start; min-width:140px; padding:11px 16px; border:0; border-radius:10px; background:#47e6a1; color:#04130d; font-weight:800; cursor:pointer; }
        button:disabled { cursor:wait; opacity:.55; }
        output { min-height:1.45em; color:#9dafc7; }
        output[data-kind="error"] { color:#ff8290; }
        output[data-kind="success"] { color:#69efb1; }
      </style>
      <form novalidate>
        <header><h2>Assistant identity assets</h2><span class="id"></span></header>
        <div class="fields">
          <label>Avatar image
            <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp" />
            <small>PNG, JPEG, or WebP · maximum 10 MiB</small>
          </label>
          <label>Reference voice
            <input name="voiceReference" type="file" accept="audio/wav,.wav" />
            <small>4–60 second WAV · normalized automatically · maximum 25 MiB</small>
          </label>
        </div>
        <button type="submit">Save assets</button>
        <output role="status" aria-live="polite"></output>
      </form>`;

    this.shadowRoot.querySelector(".id").textContent =
      `${this.getAttribute("tenant-id") ?? "tenant"} / ${this.getAttribute("assistant-id") ?? "assistant"}`;
    this.shadowRoot.querySelector("form").addEventListener("submit", (event) => this.#submit(event));
  }

  async #submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const output = form.querySelector("output");
    const button = form.querySelector("button");
    const tenantId = this.getAttribute("tenant-id");
    const assistantId = this.getAttribute("assistant-id");
    const displayName = this.getAttribute("display-name") ?? assistantId;
    const endpoint = this.getAttribute("endpoint") ?? "/settings/api/assistant-settings";
    const avatar = form.elements.avatar.files[0];
    let voiceReference = form.elements.voiceReference.files[0];

    const show = (message, kind = "") => {
      output.textContent = message;
      output.dataset.kind = kind;
    };

    try {
      if (!tenantId || !assistantId) throw new Error("tenant-id and assistant-id attributes are required");
      if (!avatar && !voiceReference) throw new Error("Choose an avatar image or reference WAV");
      if (avatar && (!IMAGE_TYPES.has(avatar.type) || avatar.size > MAX_IMAGE_BYTES)) {
        throw new Error("Avatar must be PNG, JPEG, or WebP and no larger than 10 MiB");
      }
      const wavTypeValid = voiceReference && (WAV_TYPES.has(voiceReference.type) || (!voiceReference.type && /\.wav$/i.test(voiceReference.name)));
      if (voiceReference && (!wavTypeValid || voiceReference.size > MAX_WAV_BYTES)) {
        throw new Error("Voice reference must be a WAV and no larger than 25 MiB");
      }

      if (voiceReference) {
        show("Normalizing voice to mono PCM16 at 24 kHz…");
        voiceReference = await normalizeVoiceReference(voiceReference);
      }

      const body = new FormData();
      body.set("tenantId", tenantId);
      body.set("assistantId", assistantId);
      body.set("displayName", displayName);
      if (avatar) body.set("avatar", avatar);
      if (voiceReference) body.set("voiceReference", voiceReference);

      button.disabled = true;
      show("Uploading and validating…");
      const response = await fetch(endpoint, { method: "POST", body, credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? payload.message ?? `Upload failed (${response.status})`);
      show("Assistant assets saved.", "success");
      this.dispatchEvent(new CustomEvent("settings-saved", { detail: payload, bubbles: true, composed: true }));
      form.reset();
    } catch (error) {
      show(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }
}

if (!customElements.get("blackhole-assistant-settings")) {
  customElements.define("blackhole-assistant-settings", BlackholeAssistantSettings);
}

export { BlackholeAssistantSettings };
export { encodeMonoPcm16Wav, normalizeVoiceReference };
