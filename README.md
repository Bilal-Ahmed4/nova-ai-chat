# ✦ Nova — AI Chat Assistant

A sleek, premium AI chat interface powered by **Google Gemini**. Nova delivers concise, well-structured answers through a beautiful dark-themed UI with full Markdown rendering, image attachments, and conversation persistence.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?style=flat-square&logo=express&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-2.5%20Flash-4285F4?style=flat-square&logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue?style=flat-square)

---

## 🎯 Features

- **AI-Powered Chat** — Real-time conversations with Google Gemini 2.5 Flash
- **Markdown Rendering** — Full support for headings, lists, code blocks (with language labels & copy buttons), blockquotes, links, and more
- **Image Attachments** — Upload and send images (PNG, JPEG, GIF, WebP) for multimodal AI analysis
- **Conversation Persistence** — Chat history saved to localStorage across sessions
- **Chat Export** — Download your conversation as a Markdown file
- **Suggestion Chips** — Quick-start prompts to get the conversation going
- **Typing Indicator** — Animated dots while the AI generates a response
- **Scroll-to-Bottom FAB** — Floating action button for long conversations
- **Rate Limiting** — Built-in server-side rate limiter (20 req/min per IP)
- **Error Handling** — Graceful error states with retry support
- **Edit & Regenerate** — Edit your last message or regenerate the AI response
- **Copy to Clipboard** — One-click copy for any AI response or code block
- **Premium Dark UI** — Glassmorphism header, violet accent gradient, smooth animations

---

## 📸 Screenshots

<img width="1919" height="871" alt="image" src="https://github.com/user-attachments/assets/ed4b0c69-b525-4e0c-bdde-5ac188ce5f26" />
<img width="958" height="437" alt="image" src="https://github.com/user-attachments/assets/911b6a63-b793-4cc0-a1e6-30ded11a9f6f" />



---

## 🛠️ Tech Stack

| Layer      | Technology                      |
| ---------- | ------------------------------- |
| **Backend**  | Node.js, Express 5              |
| **AI Model** | Google Gemini 2.5 Flash         |
| **Frontend** | Vanilla HTML, CSS, JavaScript   |
| **Fonts**    | Inter, JetBrains Mono (Google Fonts) |
| **Icons**    | Material Symbols Outlined       |

---

## 📁 Project Structure

```
nova-ai-chat/
├── public/                  # Frontend (served as static files)
│   ├── index.html           # Main HTML — app shell, chat UI
│   ├── style.css            # Premium dark theme with design tokens
│   ├── script.js            # Chat controller — UI state, API calls, persistence
│   └── markdown.js          # Zero-dependency Markdown-to-HTML renderer
├── server.js                # Express server — API proxy, rate limiter
├── package.json             # Project metadata & dependencies
├── .env                     # Environment variables (API key, port)
├── .gitignore               # Ignored files (node_modules, .env)
└── README.md                # You are here
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) **v18** or later
- A **Google Gemini API key** — [Get one here](https://aistudio.google.com/app/apikey)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/nova-ai-chat.git
   cd nova-ai-chat
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create a `.env` file in the root directory:

   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=3000
   ```

4. **Start the server**

   ```bash
   # Production
   npm start

   # Development (auto-reload on file changes)
   npm run dev
   ```

5. **Open your browser**

   Navigate to [http://localhost:3000](http://localhost:3000)

---

## ⚙️ Configuration

| Variable         | Default | Description                      |
| ---------------- | ------- | -------------------------------- |
| `GEMINI_API_KEY`  | —       | Your Google Gemini API key       |
| `PORT`            | `3000`  | Port the server listens on       |

### Rate Limiting

The server includes a basic in-memory rate limiter:
- **Window:** 60 seconds
- **Max requests:** 20 per IP per window

These values can be adjusted in `server.js`.

---

## 🧩 API

### `POST /api/chat`

Send a message and receive an AI response.

**Request Body:**

```json
{
  "messages": [
    {
      "role": "user",
      "content": "What is recursion?",
      "attachments": []
    }
  ]
}
```

**Image Attachment (optional):**

```json
{
  "role": "user",
  "content": "What's in this image?",
  "attachments": [
    {
      "type": "image",
      "dataUrl": "data:image/png;base64,..."
    }
  ]
}
```

**Success Response:**

```json
{
  "content": "Recursion is a technique where a function calls itself...",
  "finishReason": "STOP"
}
```

**Error Response:**

```json
{
  "error": "Too many requests. Please wait a moment before trying again.",
  "retryable": true
}
```

---

## 🧪 Scripts

| Script        | Command           | Description                         |
| ------------- | ----------------- | ----------------------------------- |
| `start`       | `npm start`       | Start the production server         |
| `dev`         | `npm run dev`     | Start with `--watch` (auto-reload)  |

---

## 🔒 Security

- **API key is server-side only** — The Gemini API key is stored in `.env` and never exposed to the client. All AI requests are proxied through the Express backend.
- **Rate limiting** — Prevents abuse with per-IP request throttling.
- **XSS protection** — The custom Markdown renderer sanitizes all HTML output via `escapeHtml()`.
- **Image validation** — Only PNG, JPEG, GIF, and WebP files under 10 MB are accepted.
- **CORS enabled** — Configurable cross-origin support.

> ⚠️ **Important:** Never commit your `.env` file. It is already included in `.gitignore`.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **ISC License**. See the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Google Gemini API](https://ai.google.dev/) — Powering the AI responses
- [Material Symbols](https://fonts.google.com/icons) — Icon set
- [Inter](https://rsms.me/inter/) & [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — Typography

---

<p align="center">
  Built with ✦ by <strong>Nova</strong>
</p>
