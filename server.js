import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const JWT_SECRET = process.env.JWT_SECRET || 'nova_jwt_secret_token_key_987654';

// --- MongoDB Database Connection ---------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('  ✦ Connected to MongoDB successfully.'))
    .catch(err => console.error('  ⚠ MongoDB connection error:', err));
} else {
  console.warn('  ⚠ WARNING: MONGODB_URI is not set in .env file! MongoDB integration disabled.');
}

// --- Mongoose Schemas & Models -----------------------------------------------
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

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
  role: { type: String, required: true }, // 'user' | 'model' (or 'assistant')
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  attachments: [{
    type: { type: String, default: 'image' },
    dataUrl: String,
    name: String
  }]
});
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

// --- Default System Prompt ---------------------------------------------------
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

// --- Middleware ---------------------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '10mb' })); // allow image uploads
app.use(express.static(join(__dirname, 'public')));

// --- Auth Middleware ---------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please log in.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Session expired or invalid. Please log in again.' });
    }
    req.user = user;
    next();
  });
}

// --- Rate limiter (basic in-memory) ------------------------------------------
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30;        // 30 requests per minute

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

function checkDbConnection(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error: 'Database connection is offline. Please make sure your MongoDB instance is running, or check your network settings.'
    });
  }
  next();
}

// --- Auth Routes -------------------------------------------------------------

// POST /api/auth/register
app.post('/api/auth/register', checkDbConnection, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const existingUser = await User.findOne({ username: new RegExp(`^${trimmedUsername}$`, 'i') });
    if (existingUser) {
      return res.status(400).json({ error: 'Username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username: trimmedUsername, passwordHash });

    res.status(201).json({ message: 'User registered successfully. You can now log in.' });
  } catch (err) {
    console.error('[Register Error]', err);
    res.status(500).json({ error: err.message || 'Failed to register user.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', checkDbConnection, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await User.findOne({ username: username.trim() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error('[Login Error]', err);
    res.status(500).json({ error: err.message || 'Failed to log in.' });
  }
});

// --- Database CRUD API Routes (JWT Authenticated) -----------------------------

// GET /api/conversations - List all conversations for the logged in user
app.get('/api/conversations', checkDbConnection, authenticateToken, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user.userId }).sort({ updatedAt: -1 });
    res.json(conversations);
  } catch (err) {
    console.error('[Get Conversations Error]', err);
    res.status(500).json({ error: err.message || 'Failed to fetch conversations.' });
  }
});

// POST /api/conversations - Create a new conversation session
app.post('/api/conversations', checkDbConnection, authenticateToken, async (req, res) => {
  try {
    const { title, settings } = req.body;
    const conversation = await Conversation.create({
      userId: req.user.userId,
      title: title || 'New Chat',
      settings: settings || {
        systemInstruction: '',
        temperature: 0.7,
        maxOutputTokens: 2048
      }
    });
    res.status(201).json(conversation);
  } catch (err) {
    console.error('[Create Conversation Error]', err);
    res.status(500).json({ error: err.message || 'Failed to create conversation.' });
  }
});

// PUT /api/conversations/:id - Update dynamic settings or title
app.put('/api/conversations/:id', checkDbConnection, authenticateToken, async (req, res) => {
  try {
    const { title, settings } = req.body;
    const updateData = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (settings !== undefined) {
      updateData.settings = {
        systemInstruction: settings.systemInstruction || '',
        temperature: settings.temperature !== undefined ? settings.temperature : 0.7,
        maxOutputTokens: settings.maxOutputTokens !== undefined ? settings.maxOutputTokens : 2048
      };
    }

    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      updateData,
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    res.json(conversation);
  } catch (err) {
    console.error('[Update Conversation Error]', err);
    res.status(500).json({ error: err.message || 'Failed to update conversation.' });
  }
});

// DELETE /api/conversations/:id - Delete a conversation and its messages
app.delete('/api/conversations/:id', checkDbConnection, authenticateToken, async (req, res) => {
  try {
    const result = await Conversation.deleteOne({ _id: req.params.id, userId: req.user.userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    await Message.deleteMany({ conversationId: req.params.id });
    res.json({ message: 'Conversation deleted successfully.' });
  } catch (err) {
    console.error('[Delete Conversation Error]', err);
    res.status(500).json({ error: err.message || 'Failed to delete conversation.' });
  }
});

// GET /api/conversations/:id/messages - Retrieve full message history for a conversation
app.get('/api/conversations/:id/messages', checkDbConnection, authenticateToken, async (req, res) => {
  try {
    // Confirm ownership
    const conversation = await Conversation.findOne({ _id: req.params.id, userId: req.user.userId });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    const messages = await Message.find({ conversationId: req.params.id }).sort({ timestamp: 1 });
    
    // Format MongoDB messages array to client format
    const formatted = messages.map(msg => ({
      id: msg._id,
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content,
      timestamp: msg.timestamp.getTime(),
      attachments: msg.attachments || [],
      status: 'delivered'
    }));

    res.json(formatted);
  } catch (err) {
    console.error('[Get Messages Error]', err);
    res.status(500).json({ error: 'Failed to retrieve messages.' });
  }
});

// --- Main Chat Routing with Event-Streaming (SSE) -----------------------------

// POST /api/chat — main streaming chat endpoint
app.post('/api/chat', rateLimit, async (req, res) => {
  try {
    const { messages, conversationId, settings } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'Messages array is required and must not be empty.',
        retryable: false
      });
    }

    // Optional Authentication check (Hybrid Storage)
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

    // Dynamic Parameter Settings
    const systemInstruction = settings?.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
    const temperature = settings?.temperature !== undefined ? parseFloat(settings.temperature) : 0.7;
    const maxOutputTokens = settings?.maxOutputTokens !== undefined ? parseInt(settings.maxOutputTokens, 10) : 2048;

    // Build Gemini-compatible request body
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: buildParts(msg)
    }));

    const geminiBody = {
      system_instruction: {
        parts: [{ text: systemInstruction }]
      },
      contents,
      generationConfig: {
        temperature,
        topP: 0.95,
        topK: 40,
        maxOutputTokens
      }
    };

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'Server misconfiguration: Gemini API Key is not set.',
        retryable: false
      });
    }

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `Gemini API error (${response.status})`;
      console.error('[Gemini Stream Error]', errMsg);
      return res.status(response.status).json({
        error: errMsg,
        retryable: response.status >= 500 || response.status === 429
      });
    }

    // Set SSE headers to start streaming immediately
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
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
      buffer = lines.pop(); // save incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Parse line starting with "data: "
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6).trim();
          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) {
              fullAssistantResponse += text;
              // Stream token to client
              res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
          } catch (e) {
            // Wait for partial chunk to complete
          }
        }
      }
    }

    // Process leftover buffer
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

    // If user is authenticated, save the user message and generated response to MongoDB
    if (isAuthenticated && conversationId) {
      try {
        const lastUserMsg = messages[messages.length - 1];
        if (lastUserMsg && lastUserMsg.role === 'user') {
          // Verify conversation ownership first
          const conversation = await Conversation.findOne({ _id: conversationId, userId });
          if (conversation) {
            // Save user message
            await Message.create({
              conversationId,
              role: 'user',
              content: lastUserMsg.content,
              attachments: lastUserMsg.attachments || []
            });

            // Save assistant message
            await Message.create({
              conversationId,
              role: 'model',
              content: fullAssistantResponse
            });

            // Update conversation timestamp
            await Conversation.findByIdAndUpdate(conversationId, { updatedAt: new Date() });
          }
        }
      } catch (dbErr) {
        console.error('[Database Save Error]', dbErr);
      }
    }

    // End stream response
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('[Server SSE Error]', err);
    // Write error to client stream
    res.write(`data: ${JSON.stringify({ error: 'Something went wrong on the server while generating response.' })}\n\n`);
    res.end();
  }
});

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

// --- Fallback: serve index.html for any non-API route ------------------------
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(join(__dirname, 'public', 'index.html'));
  }
  next();
});

// --- Start -------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  ✦ Nova server running at http://localhost:${PORT}\n`);
  if (!GEMINI_API_KEY) {
    console.warn('  ⚠ WARNING: GEMINI_API_KEY is not set in .env file!\n');
  }
});
