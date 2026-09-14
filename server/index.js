/**
 * Padovani DRI API — esqueleto protegido
 * Tabelas ficam no servidor. Cliente só recebe o resultado do cálculo.
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { calcularMetas, listarEstagios } = require("./data/dri");

const app = express();
const PORT = process.env.PORT || 3847;
const JWT_SECRET = process.env.JWT_SECRET || "mude-este-segredo-em-producao-padovani-2026";
const TOKEN_EXPIRA = "12h";

// ---- Usuários demo (em produção: banco de dados) ----
// senha de todos: "demo123"
const users = [
  {
    id: 1,
    email: "nutri@demo.com",
    nome: "Nutricionista Demo",
    crn: "CRN-4 00000",
    passwordHash: bcrypt.hashSync("demo123", 8),
    plano: "pro",
    ativo: true,
  },
  {
    id: 2,
    email: "teste@demo.com",
    nome: "Usuário Teste",
    crn: null,
    passwordHash: bcrypt.hashSync("demo123", 8),
    plano: "basic",
    ativo: true,
  },
];

// Rate limit simples em memória (por IP)
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60_000;
  const max = 60;
  let entry = hits.get(ip);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    hits.set(ip, entry);
  }
  entry.count++;
  if (entry.count > max) {
    return res.status(429).json({ erro: "Muitas requisições. Aguarde um minuto." });
  }
  next();
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(rateLimit);

// Arquivos estáticos do front
// Front: tenta public/ ao lado do server, ou server/public, ou raiz
const fs = require("fs");
const publicCandidates = [
  path.join(__dirname, "public"),
  path.join(__dirname, "../public"),
  path.join(__dirname, ".."),
];
let publicDir = publicCandidates.find((d) => fs.existsSync(path.join(d, "index.html")));
if (publicDir) {
  app.use(express.static(publicDir));
  console.log("Servindo front de:", publicDir);
} else {
  console.warn("AVISO: index.html do front nao encontrado");
}

// ---- Auth middleware ----
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ erro: "Login necessário." });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = users.find((u) => u.id === payload.sub && u.ativo);
    if (!user) return res.status(401).json({ erro: "Sessão inválida." });
    req.user = { id: user.id, email: user.email, nome: user.nome, crn: user.crn, plano: user.plano };
    next();
  } catch {
    return res.status(401).json({ erro: "Token expirado ou inválido. Faça login novamente." });
  }
}

// ---- Rotas públicas ----
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, servico: "Padovani DRI API", versao: "1.0.0" });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ erro: "E-mail e senha obrigatórios." });
  }
  const user = users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ erro: "E-mail ou senha incorretos." });
  }
  if (!user.ativo) {
    return res.status(403).json({ erro: "Conta desativada." });
  }
  const token = jwt.sign(
    { sub: user.id, email: user.email, plano: user.plano },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRA }
  );
  res.json({
    token,
    usuario: {
      id: user.id,
      email: user.email,
      nome: user.nome,
      crn: user.crn,
      plano: user.plano,
    },
    expiraEm: TOKEN_EXPIRA,
  });
});

// ---- Rotas protegidas ----
app.get("/api/me", authRequired, (req, res) => {
  res.json({ usuario: req.user });
});

app.get("/api/estagios", authRequired, (req, res) => {
  const sexo = (req.query.sexo || "F").toUpperCase();
  const condicao = req.query.condicao || "normal";
  if (!["M", "F"].includes(sexo)) {
    return res.status(400).json({ erro: "sexo deve ser M ou F" });
  }
  res.json({ estagios: listarEstagios(sexo, condicao) });
});

/**
 * Cálculo no SERVIDOR — cliente nunca vê a tabela completa
 * POST /api/calcular
 * body: { stageId, grupo?: "todos"|"vitaminas"|"minerais", pacienteNome? }
 */
app.post("/api/calcular", authRequired, (req, res) => {
  const { stageId, grupo = "todos", pacienteNome } = req.body || {};
  if (!stageId || typeof stageId !== "string") {
    return res.status(400).json({ erro: "stageId obrigatório." });
  }
  const metas = calcularMetas(stageId, grupo);
  if (!metas.length) {
    return res.status(404).json({ erro: "Estágio não encontrado ou sem dados." });
  }

  // Log de auditoria (em produção: gravar em DB)
  console.log(
    `[CALC] user=${req.user.email} stage=${stageId} grupo=${grupo} at=${new Date().toISOString()}`
  );

  res.json({
    geradoEm: new Date().toISOString(),
    profissional: {
      nome: req.user.nome,
      email: req.user.email,
      crn: req.user.crn,
      plano: req.user.plano,
    },
    pacienteNome: pacienteNome || null,
    stageId,
    grupo,
    metas,
    // watermark lógico para o relatório
    licenca: `Uso licenciado — ${req.user.nome}${req.user.crn ? " · " + req.user.crn : ""}`,
  });
});

// SPA fallback
app.get("*", (_req, res) => {
  if (publicDir) {
    return res.sendFile(path.join(publicDir, "index.html"));
  }
  res.status(404).type("html").send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0b1220;color:#e2edf7;padding:2rem">
    <h1>Padovani DRI API</h1>
    <p>API no ar, mas o front (index.html) nao foi encontrado no deploy.</p>
    <p>Coloque <code>public/index.html</code> no GitHub (ao lado da pasta server) e faca redeploy.</p>
    <p><a href="/api/health" style="color:#38bdf8">Testar /api/health</a></p>
  </body></html>`);
});

app.listen(PORT, () => {
  console.log(`\n  Padovani DRI API rodando em http://localhost:${PORT}`);
  console.log(`  Login demo: nutri@demo.com / demo123\n`);
});
