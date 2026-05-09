const form = document.querySelector("#sidecarForm");
const sourceLanguageSelect = document.querySelector("#sourceLanguage");
const targetLanguageSelect = document.querySelector("#targetLanguage");
const voiceSelect = document.querySelector("#voice");
const playTranslatedAudioCheckbox = document.querySelector("#playTranslatedAudio");
const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const statusNode = document.querySelector("#status");
const sourceLiveNode = document.querySelector("#sourceLive");
const translatedLiveNode = document.querySelector("#translatedLive");
const sourceHistoryNode = document.querySelector("#sourceHistory");
const translatedHistoryNode = document.querySelector("#translatedHistory");
const connectionStateNode = document.querySelector("#connectionState");
const languagePairNode = document.querySelector("#languagePair");
const captureStateNode = document.querySelector("#captureState");
const sessionRuntimeNode = document.querySelector("#sessionRuntime");
const translatedAudio = document.querySelector("#translatedAudio");

const sessionState = {
  peerConnection: null,
  dataChannel: null,
  capturedStream: null,
  runtimeTimer: null,
  startedAt: null,
  sourceDrafts: new Map(),
  translatedDrafts: new Map(),
  sourceTurns: [],
  translatedTurns: [],
};

function getSelectedLabel(select) {
  return select.options[select.selectedIndex]?.textContent?.trim() ?? "";
}

function setStatus(message, tone = "ok") {
  statusNode.textContent = message;
  statusNode.dataset.tone = tone;
}

function setLiveLine(node, value, emptyLabel) {
  const safeValue = value.trim();
  node.textContent = safeValue || emptyLabel;
  node.classList.toggle("empty", safeValue.length === 0);
}

function formatClock(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function renderTurns(node, turns) {
  if (turns.length === 0) {
    node.innerHTML = "";
    return;
  }

  node.innerHTML = turns
    .map(
      (turn) => `
        <article class="turn-card">
          <time>${turn.time}</time>
          <p>${turn.text}</p>
        </article>
      `,
    )
    .join("");
}

function commitTurn(kind, text) {
  const safeText = text.trim();
  if (!safeText) {
    return;
  }

  const target = kind === "source" ? sessionState.sourceTurns : sessionState.translatedTurns;
  target.unshift({
    text: safeText,
    time: new Date().toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  });

  target.splice(12);
  renderTurns(kind === "source" ? sourceHistoryNode : translatedHistoryNode, target);
}

function appendDraft(drafts, key, delta) {
  const current = drafts.get(key) ?? "";
  const next = `${current}${delta ?? ""}`.trimStart();
  drafts.set(key, next);
  return next;
}

function finalizeDraft(drafts, key, fallbackText = "") {
  const next = (drafts.get(key) ?? fallbackText ?? "").trim();
  drafts.delete(key);
  return next;
}

function resetTranscriptState() {
  sessionState.sourceDrafts.clear();
  sessionState.translatedDrafts.clear();
  sessionState.sourceTurns.length = 0;
  sessionState.translatedTurns.length = 0;
  renderTurns(sourceHistoryNode, sessionState.sourceTurns);
  renderTurns(translatedHistoryNode, sessionState.translatedTurns);
  setLiveLine(sourceLiveNode, "", "Esperando audio de la reunión.");
  setLiveLine(translatedLiveNode, "", "La traducción aparecerá aquí.");
}

function startRuntime() {
  stopRuntime();
  sessionState.startedAt = Date.now();
  sessionRuntimeNode.textContent = "00:00";
  sessionState.runtimeTimer = window.setInterval(() => {
    if (!sessionState.startedAt) {
      return;
    }

    const elapsedSeconds = Math.floor((Date.now() - sessionState.startedAt) / 1000);
    sessionRuntimeNode.textContent = formatClock(elapsedSeconds);
  }, 1000);
}

function stopRuntime() {
  if (sessionState.runtimeTimer !== null) {
    window.clearInterval(sessionState.runtimeTimer);
    sessionState.runtimeTimer = null;
  }
}

function updateSessionLabels() {
  const source = getSelectedLabel(sourceLanguageSelect) || "Auto";
  const target = getSelectedLabel(targetLanguageSelect) || "Español";
  languagePairNode.textContent = `${source} → ${target}`;
}

function syncPlaybackPreference() {
  translatedAudio.muted = !playTranslatedAudioCheckbox.checked;
}

async function parseErrorMessage(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    return payload.error ?? "La sesión Realtime no se pudo abrir.";
  }

  const text = await response.text();
  return text || "La sesión Realtime no se pudo abrir.";
}

function getEventKey(event, fallback) {
  return event.item_id || event.response_id || event.output_index || fallback;
}

function handleRealtimeEvent(event) {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      connectionStateNode.textContent = "Sesión lista";
      return;
    case "conversation.item.input_audio_transcription.delta": {
      const next = appendDraft(
        sessionState.sourceDrafts,
        getEventKey(event, "source"),
        event.delta ?? "",
      );
      setLiveLine(sourceLiveNode, next, "Esperando audio de la reunión.");
      return;
    }
    case "conversation.item.input_audio_transcription.completed": {
      const key = getEventKey(event, "source");
      const transcript = finalizeDraft(
        sessionState.sourceDrafts,
        key,
        event.transcript ?? "",
      );
      commitTurn("source", transcript);
      setLiveLine(sourceLiveNode, "", "Esperando audio de la reunión.");
      return;
    }
    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta":
    case "response.output_text.delta": {
      const next = appendDraft(
        sessionState.translatedDrafts,
        getEventKey(event, "translated"),
        event.delta ?? "",
      );
      setLiveLine(translatedLiveNode, next, "La traducción aparecerá aquí.");
      return;
    }
    case "response.output_audio_transcript.done":
    case "response.audio_transcript.done":
    case "response.output_text.done": {
      const key = getEventKey(event, "translated");
      const transcript = finalizeDraft(
        sessionState.translatedDrafts,
        key,
        event.transcript ?? event.text ?? "",
      );
      commitTurn("translated", transcript);
      setLiveLine(translatedLiveNode, "", "La traducción aparecerá aquí.");
      return;
    }
    case "error":
      setStatus(event.error?.message ?? "OpenAI devolvió un error de Realtime.", "error");
      return;
    default:
      return;
  }
}

function wireDataChannel(channel) {
  channel.addEventListener("open", () => {
    setStatus("Conexión abierta. La traducción arrancará cuando entren voces en Meet.", "ok");
  });

  channel.addEventListener("message", (messageEvent) => {
    try {
      handleRealtimeEvent(JSON.parse(messageEvent.data));
    } catch (error) {
      console.error("No se pudo interpretar un evento de Realtime", error);
    }
  });
}

function teardownPeerConnection() {
  if (sessionState.dataChannel) {
    sessionState.dataChannel.close();
    sessionState.dataChannel = null;
  }

  if (sessionState.peerConnection) {
    sessionState.peerConnection.ontrack = null;
    sessionState.peerConnection.onconnectionstatechange = null;
    sessionState.peerConnection.close();
    sessionState.peerConnection = null;
  }
}

function teardownCapture() {
  if (sessionState.capturedStream) {
    sessionState.capturedStream.getTracks().forEach((track) => track.stop());
    sessionState.capturedStream = null;
  }
}

function stopSidecar(reason = "Sidecar detenido.") {
  teardownPeerConnection();
  teardownCapture();
  stopRuntime();
  sessionState.startedAt = null;
  translatedAudio.srcObject = null;
  connectionStateNode.textContent = "Sin conectar";
  captureStateNode.textContent = "No compartido";
  sessionRuntimeNode.textContent = "00:00";
  startButton.disabled = false;
  stopButton.disabled = true;
  setStatus(reason, "warn");
}

async function startSidecar(event) {
  event.preventDefault();
  stopSidecar("Preparando una nueva sesión...");
  resetTranscriptState();
  updateSessionLabels();

  try {
    setStatus(
      "Selecciona la pestaña de Google Meet y confirma que vas a compartir el audio de la pestaña.",
      "warn",
    );

    const capturedStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    const [audioTrack] = capturedStream.getAudioTracks();
    if (!audioTrack) {
      capturedStream.getTracks().forEach((track) => track.stop());
      throw new Error(
        "No llegó ninguna pista de audio. Vuelve a compartir la pestaña y activa el audio de la pestaña.",
      );
    }

    sessionState.capturedStream = capturedStream;
    captureStateNode.textContent = "Audio compartido";
    startButton.disabled = true;
    stopButton.disabled = false;
    startRuntime();
    syncPlaybackPreference();

    const peerConnection = new RTCPeerConnection();
    sessionState.peerConnection = peerConnection;

    peerConnection.addTrack(audioTrack, capturedStream);
    peerConnection.ontrack = (trackEvent) => {
      translatedAudio.srcObject = trackEvent.streams[0];
      syncPlaybackPreference();
    };

    peerConnection.onconnectionstatechange = () => {
      connectionStateNode.textContent = peerConnection.connectionState;

      if (peerConnection.connectionState === "failed") {
        stopSidecar("La conexión WebRTC falló. Puedes volver a intentarlo.");
      }
    };

    capturedStream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        stopSidecar("Se detuvo la compartición de pantalla o pestaña.");
      });
    });

    capturedStream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        stopSidecar("La pista de audio dejó de recibirse desde Meet.");
      });
    });

    const dataChannel = peerConnection.createDataChannel("oai-events");
    sessionState.dataChannel = dataChannel;
    wireDataChannel(dataChannel);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const params = new URLSearchParams({
      sourceLanguage: sourceLanguageSelect.value,
      targetLanguage: targetLanguageSelect.value,
      voice: voiceSelect.value,
    });

    const response = await fetch(`/api/realtime/session?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    const answerSdp = await response.text();
    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

    setStatus(
      "Sesión conectada. La traducción y los subtítulos se actualizarán a medida que hablen los participantes.",
      "ok",
    );
  } catch (error) {
    stopSidecar();
    setStatus(
      error instanceof Error ? error.message : "No se pudo iniciar el sidecar.",
      "error",
    );
  }
}

form.addEventListener("submit", startSidecar);
stopButton.addEventListener("click", () => stopSidecar());
playTranslatedAudioCheckbox.addEventListener("change", syncPlaybackPreference);
sourceLanguageSelect.addEventListener("change", updateSessionLabels);
targetLanguageSelect.addEventListener("change", updateSessionLabels);
window.addEventListener("beforeunload", () => stopSidecar());

updateSessionLabels();
syncPlaybackPreference();
setStatus(
  "El sidecar está listo. Cuando arranques, el navegador te pedirá que selecciones la pestaña de Meet.",
  "ok",
);
