# ✦ Nova — Minimalist AI Chat App

A sleek, premium AI chat interface powered by **Google Gemini**. Nova features a beautiful, unified dark-themed UI with clean Markdown rendering, image attachments, user authentication (MongoDB + JWT), and robust fallback guest storage.

---

## 🎯 Features

* **AI-Powered Chat** — Real-time responses using the Gemini 2.5 Flash model.
* **Hybrid Storage Architecture**:
  * **Guest Mode** — Test the UI instantly; session data is stored in the browser's `sessionStorage`.
  * **Authenticated Mode** — Create a secure account to save conversations persistently in a MongoDB cluster.
* **Minimalist UI** — obsidian-slate theme with clean focus boundaries, a simple landing page suggestion grid, and elegant active states.
* **Zero-Dependency Markdown Renderer** — Renders lists, bold/italic, headers, blockquotes, and links safely.
* **Terminal Code Blocks** — Beautifully formatted code boxes featuring custom headers with language tags and a one-click copy button.
* **Image Uploads** — Process PNG, JPEG, GIF, and WebP images directly using Gemini's multimodal vision features.
* **Unified Single-Port Monolith** — Express backend serves static frontend files directly, eliminating CORS configuration issues during local development.

---

## 🛠️ Tech Stack

* **Frontend**: Vanilla HTML5, CSS3, ES6 JavaScript
* **Backend**: Node.js, Express
* **Database**: MongoDB (via Mongoose)
* **AI Model**: Google Gemini 2.5 Flash
* **Authentication**: JSON Web Tokens (JWT) & bcryptjs

---

## 🚀 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) v18 or later
* A Google Gemini API Key — [Get one here](https://aistudio.google.com/app/apikey)
* A MongoDB connection string (Local Instance or MongoDB Atlas cluster)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Bilal-Ahmed4/nova-ai-chat.git
   cd nova-ai-chat
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the root directory:
   ```env
   # API keys
   GEMINI_API_KEY=your_gemini_api_key_here
   MONGODB_URI=your_mongodb_connection_uri_here
   JWT_SECRET=your_custom_jwt_secret_here

   # Server port (optional, defaults to 3000)
   PORT=3000
   ```

4. **Start the application**
   ```bash
   # Development mode (auto-reload on file edits)
   npm run dev

   # Production mode
   npm start
   ```

5. **Access the application**
   Open your browser and navigate to [http://localhost:3000](http://localhost:3000)

---

## ⚙️ Configuration Variables

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `GEMINI_API_KEY` | Yes | — | Authentication key for Google AI services |
| `MONGODB_URI` | No | — | Connects to your MongoDB cluster. If omitted, database routes return offline warnings and the app defaults to Guest Mode. |
| `JWT_SECRET` | No | `nova_jwt_secret...` | Key used to sign authorization tokens. |
| `PORT` | No | `3000` | Port the Node webserver runs on. |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License
Licensed under the **ISC License**. See the `LICENSE` file for details.
