// Vercel Serverless Function — /api/chat
// This mirrors the Express /api/chat endpoint for Vercel deployment.

const GEMINI_MODEL = 'gemini-2.5-flash';

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

// --- Rate limiter (basic in-memory — resets per cold start) ------------------
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 20;        // 20 requests per minute

// --- Helpers -----------------------------------------------------------------
function buildParts(msg) {
  const parts = [];

  if (msg.content) {
    parts.push({ text: msg.content });
  }

  if (msg.attachments && Array.isArray(msg.attachments)) {
    for (const att of msg.attachments) {
      if (att.type === 'image' && att.dataUrl) {
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

// --- Handler -----------------------------------------------------------------
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', retryable: false });
  }

  // --- Rate limiting ---
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
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

  // --- Main logic ---
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'Messages array is required and must not be empty.',
        retryable: false
      });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'Server misconfiguration: API key not set.',
        retryable: false
      });
    }

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

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

    const candidate = data?.candidates?.[0];
    if (!candidate || !candidate.content?.parts?.[0]?.text) {
      return res.status(502).json({
        error: 'Empty response from AI model. Try rephrasing your question.',
        retryable: true
      });
    }

    const responseText = candidate.content.parts[0].text;

    return res.json({
      content: responseText,
      finishReason: candidate.finishReason || 'STOP'
    });

  } catch (err) {
    console.error('[Server Error]', err.message);
    return res.status(500).json({
      error: 'Something went wrong on our end. Please try again.',
      retryable: true
    });
  }
}
