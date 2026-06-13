// Vercel Serverless Function — /api/chat
// This mirrors the Express /api/chat endpoint with SSE streaming and Mongoose connection caching.

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const GEMINI_MODEL = 'gemini-2.5-flash';
const JWT_SECRET = process.env.JWT_SECRET || 'nova_jwt_secret_token_key_987654';

// Cache connection
let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) return null;

  cachedDb = await mongoose.connect(MONGODB_URI);
  return cachedDb;
}

// Models
const conversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, default: 'New Chat' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  settings: {
    systemInstruction: { type: String, default: '' },
    temperature: { type: Number, default: 0.7 },
    maxOutputTokens: { type: Number, default: 2048 }
  }
});
const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  role: { type: String, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  attachments: [{
    type: { type: String, default: 'image' },
    dataUrl: String,
    name: String
  }]
});
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

const DEFAULT_SYSTEM_INSTRUCTION = `You are Nova, a helpful and precise AI assistant.

Rules:
- Be concise. Default to short, direct answers unless the user asks for detail.
- Use markdown formatting: headings, bullet lists, numbered lists, bold, code blocks with language tags.
- When writing code, always specify the language after the opening triple backticks.
- If a question is ambiguous, ask one clarifying question before answering.
- Never fabricate URLs, citations, or data you're unsure about.
- For technical topics, structure your response with: brief explanation → code example → key notes.
- Avoid filler phrases like "Sure!", "Of course!", "Great question!". Get to the point.
- If you don't know something, say so plainly.`;

function buildParts(msg) {
  const parts = [];
  if (msg.content) parts.push({ text: msg.content });
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', retryable: false });
  }

  try {
    const { messages, conversationId, settings } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required.', retryable: false });
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let userId = null;
    let isAuthenticated = false;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
        isAuthenticated = true;
      } catch (err) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Gemini API key not set.', retryable: false });
    }

    const systemInstruction = settings?.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
    const temperature = settings?.temperature !== undefined ? parseFloat(settings.temperature) : 0.7;
    const maxOutputTokens = settings?.maxOutputTokens !== undefined ? parseInt(settings.maxOutputTokens, 10) : 2048;

    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: buildParts(msg)
    }));

    const geminiBody = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: {
        temperature,
        topP: 0.95,
        topK: 40,
        maxOutputTokens
      }
    };

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: errData?.error?.message || `Gemini error (${response.status})`,
        retryable: response.status >= 500
      });
    }

    // Set streaming headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullAssistantResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6).trim();
          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) {
              fullAssistantResponse += text;
              res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
          } catch (e) {}
        }
      }
    }

    if (buffer && buffer.startsWith('data: ')) {
      try {
        const parsed = JSON.parse(buffer.slice(6).trim());
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) {
          fullAssistantResponse += text;
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      } catch (e) {}
    }

    // Save history if logged in
    if (isAuthenticated && conversationId) {
      await connectToDatabase();
      try {
        const conversation = await Conversation.findOne({ _id: conversationId, userId });
        if (conversation) {
          const lastUserMsg = messages[messages.length - 1];
          if (lastUserMsg && lastUserMsg.role === 'user') {
            await Message.create({
              conversationId,
              role: 'user',
              content: lastUserMsg.content,
              attachments: lastUserMsg.attachments || []
            });
            await Message.create({
              conversationId,
              role: 'model',
              content: fullAssistantResponse
            });
            await Conversation.findByIdAndUpdate(conversationId, { updatedAt: new Date() });
          }
        }
      } catch (dbErr) {
        console.error('[DB Vercel Save Error]', dbErr);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('[Vercel Serverless Error]', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}
