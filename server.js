import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// --- System Prompt -----------------------------------------------------------
const SYSTEM_INSTRUCTION = `You are Nova, a helpful and precise AI assistant.

Rules:
- Be concise. Default to short, direct answers unless the user asks for detail.
- Use markdown formatting: headings, bullet lists, numbered lists, bold, code blocks with language tags.
- When writing code, always specify the language after the opening triple backticks.
- If a question is ambiguous, ask one clarifying question before answering.
- Never fabricate URLs, citations, or data you're unsure about.
- For technical topics, structure your response with: brief explanation → code example → key notes.
- Avoid filler phrases like "Sure!", "Of course!", "Great question!". Get to the point.
- If you don't know something, say so plainly.`;

// --- Middleware ---------------------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '10mb' })); // allow image uploads
app.use(express.static(join(__dirname, 'public')));

// --- Rate limiter (basic in-memory) ------------------------------------------
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 20;        // 20 requests per minute

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_LIMIT_WINDOW;
  }

  record.count++;
  rateLimitMap.set(ip, record);

  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too many requests. Please wait a moment before trying again.',
      retryable: true
    });
  }

  next();
}

// --- API Routes --------------------------------------------------------------

// POST /api/chat — main chat endpoint
app.post('/api/chat', rateLimit, async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'Messages array is required and must not be empty.',
        retryable: false
      });
    }

    // Build Gemini-compatible request body
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: buildParts(msg)
    }));

    const geminiBody = {
      system_instruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      contents,
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192
      }
    };

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || `Gemini API error (${response.status})`;
      console.error('[Gemini Error]', errMsg);
      return res.status(response.status).json({
        error: errMsg,
        retryable: response.status >= 500 || response.status === 429
      });
    }

    // Extract response text
    const candidate = data?.candidates?.[0];
    if (!candidate || !candidate.content?.parts?.[0]?.text) {
      return res.status(502).json({
        error: 'Empty response from AI model. Try rephrasing your question.',
        retryable: true
      });
    }

    const responseText = candidate.content.parts[0].text;

    res.json({
      content: responseText,
      finishReason: candidate.finishReason || 'STOP'
    });

  } catch (err) {
    console.error('[Server Error]', err.message);
    res.status(500).json({
      error: 'Something went wrong on our end. Please try again.',
      retryable: true
    });
  }
});

// --- Helpers -----------------------------------------------------------------

function buildParts(msg) {
  const parts = [];

  // Text content
  if (msg.content) {
    parts.push({ text: msg.content });
  }

  // Image attachments (base64)
  if (msg.attachments && Array.isArray(msg.attachments)) {
    for (const att of msg.attachments) {
      if (att.type === 'image' && att.dataUrl) {
        // Extract base64 data from data URL
        const match = att.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          parts.push({
            inline_data: {
              mime_type: match[1],
              data: match[2]
            }
          });
        }
      }
    }
  }

  return parts;
}

// --- Fallback: serve index.html for any non-API route ------------------------
app.get((req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// --- Start -------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  ✦ Nova server running at http://localhost:${PORT}\n`);
  if (!GEMINI_API_KEY) {
    console.warn('  ⚠ WARNING: GEMINI_API_KEY is not set in .env file!\n');
  }
});
