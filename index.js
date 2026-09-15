/**
 * Padovani DRI API — backend protegido
 * As tabelas completas ficam em server/data/dri.js.
 * O navegador recebe somente os estágios e o resultado solicitado.
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { calcularMetas, listarEstagios } = require('./data/dri');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3847;
const JWT_SECRET = process.env.JWT_SECRET || 'mude-este-segredo-em-producao-padovani-2026';
const TOKEN_EXPIRA = '12h';

// Usuários de demonstração. Para produção, mova os usuários para um banco de dados.
const users = [
  {
    id: 1,
    email: 'nutri@demo.com',
    nome: 'Nutricionista Demo',
    crn: 'CRN-4 00000',
    passwordHash: bcrypt.hashSync('demo123', 10),
    plano: 'pro',
    ativo: true
  },
  {
    id: 2,
    email: 'teste@demo.com',
    nome: 'Usuário Teste',
    crn: null,
    passwordHash: bcrypt.hashSync('demo123', 10),
    plano: 'basic',
    ativo: true
  }
];

// Rate limit simples por IP.
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60_000;
  const max = 60;
  let entry = hits.get(ip);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    hits.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > max) return res.status(429).json({ erro: 'Muitas requisições. Aguarde um minuto.' });
  next();
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit);

// Frontend: usa a raiz do repositório, caso não exista public/.
const publicCandidates = [
  path.join(__dirname, 'public'),
  path.join(__dirname, '../public'),
  path.join(__dirname, '..')
];
const publicDir = publicCandidates.find(d => fs.existsSync(path.join(d, 'index.html')));
if (publicDir) {
  app.use(express.static(publicDir));
  console.log('Servindo front de:', publicDir);
} else {
  console.warn('AVISO: index.html do front não encontrado.');
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Login necessário.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = users.find(u => u.id === payload.sub && u.ativo);
    if (!user) return res.status(401).json({ erro: 'Sessão inválida.' });
    req.user = { id: user.id, email: user.email, nome: user.nome, crn: user.crn, plano: user.plano };
    next();
  } catch {
    return res.status(401).json({ erro: 'Token expirado ou inválido. Faça login novamente.' });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, servico: 'Padovani DRI API', versao: '1.1.0' });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ erro: 'E-mail e senha obrigatórios.' });
  const user = users.find(u => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }
  if (!user.ativo) return res.status(403).json({ erro: 'Conta desativada.' });

  const token = jwt.sign(
    { sub: user.id, email: user.email, plano: user.plano },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRA }
  );

  res.json({
    token,
    usuario: { id: user.id, email: user.email, nome: user.nome, crn: user.crn, plano: user.plano },
    expiraEm: TOKEN_EXPIRA
  });
});

app.get('/api/me', authRequired, (req, res) => res.json({ usuario: req.user }));

app.get('/api/estagios', authRequired, (req, res) => {
  const sexo = String(req.query.sexo || 'F').toUpperCase();
  const condicao = String(req.query.condicao || 'normal').toLowerCase();
  if (!['M', 'F'].includes(sexo)) return res.status(400).json({ erro: 'sexo deve ser M ou F' });
  if (!['normal', 'gestante', 'lactante'].includes(condicao)) return res.status(400).json({ erro: 'condição inválida' });
  res.json({ estagios: listarEstagios(sexo, condicao) });
});

app.post('/api/calcular', authRequired, (req, res) => {
  const { stageId, grupo = 'todos', pacienteNome = '' } = req.body || {};
  if (!stageId || typeof stageId !== 'string') return res.status(400).json({ erro: 'stageId obrigatório.' });
  if (!['todos', 'vitaminas', 'minerais'].includes(grupo)) return res.status(400).json({ erro: 'grupo inválido.' });

  const metas = calcularMetas(stageId, grupo);
  if (!metas.length) return res.status(404).json({ erro: 'Estágio não encontrado ou sem dados.' });

  console.log(`[CALC] user=${req.user.email} stage=${stageId} grupo=${grupo} at=${new Date().toISOString()}`);
  res.json({
    geradoEm: new Date().toISOString(),
    profissional: { nome: req.user.nome, email: req.user.email, crn: req.user.crn, plano: req.user.plano },
    pacienteNome: String(pacienteNome || '').slice(0, 120) || null,
    stageId,
    grupo,
    metas,
    licenca: `Uso licenciado — ${req.user.nome}${req.user.crn ? ' · ' + req.user.crn : ''}`
  });
});

app.get('*', (_req, res) => {
  if (publicDir) return res.sendFile(path.join(publicDir, 'index.html'));
  res.status(404).type('html').send('<!doctype html><html><body><h1>Padovani DRI API</h1><p>index.html não encontrado.</p><p><a href="/api/health">/api/health</a></p></body></html>');
});

app.listen(PORT, () => {
  console.log(`Padovani DRI API rodando em http://localhost:${PORT}`);
  console.log('Login demo: nutri@demo.com / demo123');
  if (!process.env.JWT_SECRET) console.warn('ATENÇÃO: defina JWT_SECRET no Render para produção.');
});
