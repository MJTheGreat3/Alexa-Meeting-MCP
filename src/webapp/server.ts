import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMeetingPipelineTurn } from "./agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/voice-turn", async (req, res) => {
  const transcript = String(req.body?.transcript ?? "").trim();
  if (!transcript) {
    res.status(400).json({ error: "transcript is required" });
    return;
  }
  try {
    const result = await runMeetingPipelineTurn(transcript);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const port = Number(process.env.WEBAPP_PORT ?? 3334);
app.listen(port, () => {
  console.log(`Route B simulator listening on http://localhost:${port}`);
  console.log(`(expects the real MCP server running at ${process.env.MCP_SERVER_URL ?? "http://localhost:3333/mcp"})`);
});
