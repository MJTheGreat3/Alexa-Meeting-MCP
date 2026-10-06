import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Groq, { toFile } from "groq-sdk";
import { runMeetingPipelineTurn } from "./agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/transcribe", express.raw({ type: "*/*", limit: "25mb" }), async (req, res) => {
  const audio = req.body as Buffer;
  if (!audio || audio.length === 0) {
    res.status(400).json({ error: "audio body is required" });
    return;
  }
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    res.status(500).json({ error: "GROQ_API_KEY is not set" });
    return;
  }
  try {
    const groq = new Groq({ apiKey: groqApiKey });
    const transcription = await groq.audio.transcriptions.create({
      model: "whisper-large-v3-turbo",
      file: await toFile(audio, "audio.wav"),
    });
    res.json({ text: transcription.text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/voice-turn", async (req, res) => {
  const transcript = String(req.body?.transcript ?? "").trim();
  if (!transcript) {
    res.status(400).json({ error: "transcript is required" });
    return;
  }
  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();
  try {
    await runMeetingPipelineTurn(transcript, (turn) => {
      res.write(JSON.stringify(turn) + "\n");
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.write(JSON.stringify({ type: "error", text: message }) + "\n");
  } finally {
    res.end();
  }
});

const port = Number(process.env.WEBAPP_PORT ?? 3334);
app.listen(port, () => {
  console.log(`Route B simulator listening on http://localhost:${port}`);
  console.log(`(expects the real MCP server running at ${process.env.MCP_SERVER_URL ?? "http://localhost:3333/mcp"})`);
});
