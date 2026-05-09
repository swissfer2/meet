import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const openAiRealtimeApiPath = process.env.OPENAI_REALTIME_API_PATH ?? "/v1/realtime/calls";
const openAiRealtimeModel = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";
const openAiTranscriptionModel =
  process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe";
const supportedLanguages = ["auto", "en", "es", "fr", "de", "it", "pt"];
const supportedTargetLanguages = ["en", "es", "fr", "de", "it", "pt"];
const supportedVoices = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
];
const defaultRealtimeVoice = z
  .enum(supportedVoices)
  .catch("sage")
  .parse(process.env.OPENAI_REALTIME_VOICE);

const realtimeSessionQuerySchema = z.object({
  sourceLanguage: z.enum(supportedLanguages).catch("auto"),
  targetLanguage: z.enum(supportedTargetLanguages).catch("es"),
  voice: z.enum(supportedVoices).catch(defaultRealtimeVoice),
});

function readSourceFile(fileName) {
  return readFileSync(resolve(process.cwd(), `src/${fileName}`), "utf8");
}

function sendJson(res, statusCode, payload, includeBody = true) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(includeBody ? JSON.stringify(payload) : "");
}

function sendText(res, statusCode, contentType, body, includeBody = true) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.end(includeBody ? body : "");
}

function pickQueryValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}

function buildRealtimeTranslationInstructions(sourceLanguage, targetLanguage) {
  const sourceHint =
    sourceLanguage === "auto"
      ? "Detect the spoken language automatically."
      : `The source language will usually be ${sourceLanguage}.`;

  return [
    "You are a simultaneous interpreter for a live Google Meet call.",
    sourceHint,
    `Translate each utterance into ${targetLanguage}.`,
    "Preserve the speaker's meaning, tone, and level of formality.",
    "Do not answer questions, add commentary, or act like an assistant.",
    "Keep the translated speech concise and natural for spoken playback and subtitles.",
    "If a word is unclear, make your best guess and briefly signal uncertainty.",
  ].join(" ");
}

function buildRealtimeSessionConfig(sourceLanguage, targetLanguage, voice) {
  return {
    type: "realtime",
    model: openAiRealtimeModel,
    output_modalities: ["audio"],
    instructions: buildRealtimeTranslationInstructions(sourceLanguage, targetLanguage),
    audio: {
      input: {
        noise_reduction: {
          type: "far_field",
        },
        turn_detection: {
          type: "server_vad",
        },
        transcription: {
          model: openAiTranscriptionModel,
          ...(sourceLanguage === "auto" ? {} : { language: sourceLanguage }),
        },
      },
      output: {
        voice,
      },
    },
  };
}

function extractOpenAiError(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed.error?.message ?? raw;
  } catch {
    return raw;
  }
}

async function readRequestBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function handleRealtimeSessionRequest(req, res, url) {
  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 500, {
      error:
        "Falta OPENAI_API_KEY en el entorno. Añádela antes de iniciar el sidecar de Meet.",
    });
    return;
  }

  const rawSdp = await readRequestBody(req);
  if (rawSdp.trim().length === 0) {
    sendJson(res, 400, {
      error: "La sesión Realtime necesita un SDP válido en el cuerpo de la petición.",
    });
    return;
  }

  const query = realtimeSessionQuerySchema.parse({
    sourceLanguage: pickQueryValue(url.searchParams.getAll("sourceLanguage")),
    targetLanguage: pickQueryValue(url.searchParams.getAll("targetLanguage")),
    voice: pickQueryValue(url.searchParams.getAll("voice")),
  });

  const formData = new FormData();
  formData.set("sdp", rawSdp);
  formData.set(
    "session",
    JSON.stringify(
      buildRealtimeSessionConfig(
        query.sourceLanguage,
        query.targetLanguage,
        query.voice,
      ),
    ),
  );

  try {
    const response = await fetch(`https://api.openai.com${openAiRealtimeApiPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    const payload = await response.text();
    if (!response.ok) {
      sendJson(res, response.status, {
        error: extractOpenAiError(payload),
      });
      return;
    }

    sendText(res, 200, "application/sdp", payload);
  } catch (error) {
    if (error instanceof Error) {
      sendJson(res, 500, { error: error.message });
      return;
    }

    sendJson(res, 500, {
      error: "No se pudo crear la sesión Realtime para Google Meet.",
    });
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";
  const includeBody = method !== "HEAD";
  const isStaticRequest = method === "GET" || method === "HEAD";

  if (isStaticRequest && url.pathname === "/") {
    sendText(
      res,
      200,
      "text/html; charset=utf-8",
      readSourceFile("meet-sidecar.html"),
      includeBody,
    );
    return;
  }

  if (isStaticRequest && url.pathname === "/meet-sidecar") {
    sendText(
      res,
      200,
      "text/html; charset=utf-8",
      readSourceFile("meet-sidecar.html"),
      includeBody,
    );
    return;
  }

  if (isStaticRequest && url.pathname === "/meet-sidecar.js") {
    sendText(
      res,
      200,
      "application/javascript; charset=utf-8",
      readSourceFile("meet-sidecar.js"),
      includeBody,
    );
    return;
  }

  if (isStaticRequest && url.pathname === "/meet-sidecar.css") {
    sendText(
      res,
      200,
      "text/css; charset=utf-8",
      readSourceFile("meet-sidecar.css"),
      includeBody,
    );
    return;
  }

  if (method === "POST" && url.pathname === "/api/realtime/session") {
    await handleRealtimeSessionRequest(req, res, url);
    return;
  }

  sendJson(res, 404, {
    error: "Ruta no encontrada.",
  }, includeBody);
}).listen(port, host, () => {
  console.log(
    `Meet sidecar disponible en http://${host}:${port}`,
  );
});
