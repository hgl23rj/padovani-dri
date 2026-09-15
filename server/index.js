/**
 * Padovani DRI API V2
 * Modo DEMO + Modo PROFISSIONAL
 *
 * As tabelas completas DRI permanecem em:
 * server/data/dri.js
 *
 * As limitações do modo DEMO são aplicadas no servidor.
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const {
  calcularMetas,
  listarEstagios
} = require("./data/dri");

const app = express();

app.set("trust proxy", 1);

const PORT = process.env.PORT || 3847;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "mude-este-segredo-em-producao-padovani-2026";

const TOKEN_EXPIRA = "12h";

/* =========================================================
   CONFIGURAÇÃO DO MODO DEMO
   ========================================================= */

const DEMO_MAX_CALCULOS = 5;
const DEMO_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEMO_MAX_NUTRIENTES = 10;

/* =========================================================
   USUÁRIOS DE TESTE
   ========================================================= */

const users = [
  {
    id: 1,
    email: "nutri@demo.com",
    nome: "Nutricionista Demo",
    crn: "CRN-4 00000",
    passwordHash: bcrypt.hashSync("demo123", 10),
    plano: "pro",
    ativo: true
  },

  {
    id: 2,
    email: "teste@demo.com",
    nome: "Usuário Demo",
    crn: null,
    passwordHash: bcrypt.hashSync("demo123", 10),
    plano: "demo",
    ativo: true
  }
];

/* =========================================================
   MIDDLEWARES
   ========================================================= */

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(
  express.json({
    limit: "32kb"
  })
);

/* =========================================================
   RATE LIMIT GERAL
   ========================================================= */

const hits = new Map();

function rateLimit(req, res, next) {
  const ip =
    req.ip ||
    req.connection.remoteAddress ||
    "unknown";

  const now = Date.now();

  const windowMs = 60 * 1000;
  const max = 60;

  let entry = hits.get(ip);

  if (!entry || now - entry.start > windowMs) {
    entry = {
      start: now,
      count: 0
    };

    hits.set(ip, entry);
  }

  entry.count++;

  if (entry.count > max) {
    return res.status(429).json({
      erro: "Muitas requisições. Aguarde um minuto."
    });
  }

  next();
}

app.use(rateLimit);

/* =========================================================
   LOCALIZAÇÃO DO FRONTEND
   ========================================================= */

const publicCandidates = [
  path.join(__dirname, "public"),
  path.join(__dirname, "../public"),
  path.join(__dirname, "..")
];

const publicDir = publicCandidates.find((directory) =>
  fs.existsSync(
    path.join(directory, "index.html")
  )
);

if (publicDir) {
  app.use(express.static(publicDir));

  console.log(
    "Servindo frontend de:",
    publicDir
  );
} else {
  console.warn(
    "AVISO: index.html não encontrado."
  );
}

/* =========================================================
   FUNÇÃO: VERIFICAR PROFISSIONAL
   ========================================================= */

function isProfessional(user) {
  return (
    user &&
    (
      user.plano === "pro" ||
      user.plano === "profissional"
    )
  );
}

/* =========================================================
   AUTENTICAÇÃO
   ========================================================= */

function authRequired(req, res, next) {
  const header =
    req.headers.authorization || "";

  const token =
    header.startsWith("Bearer ")
      ? header.slice(7)
      : null;

  if (!token) {
    return res.status(401).json({
      erro: "Login necessário."
    });
  }

  try {
    const payload = jwt.verify(
      token,
      JWT_SECRET
    );

    const user = users.find(
      (u) =>
        u.id === payload.sub &&
        u.ativo
    );

    if (!user) {
      return res.status(401).json({
        erro: "Sessão inválida."
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      nome: user.nome,
      crn: user.crn,
      plano: user.plano
    };

    next();

  } catch (error) {

    return res.status(401).json({
      erro:
        "Token expirado ou inválido. Faça login novamente."
    });
  }
}

/* =========================================================
   CONTROLE DE USO DEMO
   ========================================================= */

const demoUsage = new Map();

function demoKey(req) {
  return (
    String(req.user.id) +
    ":" +
    (req.ip || "unknown")
  );
}

function getDemoUsage(req) {
  const key = demoKey(req);

  const now = Date.now();

  let entry = demoUsage.get(key);

  if (
    !entry ||
    now - entry.startedAt >= DEMO_WINDOW_MS
  ) {
    entry = {
      startedAt: now,
      count: 0
    };

    demoUsage.set(key, entry);
  }

  return entry;
}

function consumeDemoCalculation(req) {
  const entry = getDemoUsage(req);

  if (entry.count >= DEMO_MAX_CALCULOS) {
    return false;
  }

  entry.count++;

  return true;
}

/* =========================================================
   ESTÁGIOS DISPONÍVEIS NO DEMO
   ========================================================= */

function listarEstagiosDemo(sexo) {

  const todos =
    listarEstagios(
      sexo,
      "normal"
    ) || [];

  const wanted = [
    /19\s*[–-]\s*30/i,
    /31\s*[–-]\s*50/i,
    /51\s*[–-]\s*70/i
  ];

  const escolhidos = [];

  for (const regex of wanted) {

    const found = todos.find(
      (stage) =>
        regex.test(
          String(stage.label || "")
        )
    );

    if (
      found &&
      !escolhidos.some(
        (item) =>
          item.id === found.id
      )
    ) {
      escolhidos.push(found);
    }
  }

  /*
   * Fallback:
   * caso os nomes das faixas no dri.js
   * sejam diferentes.
   */

  if (escolhidos.length < 3) {

    for (const stage of todos) {

      if (
        !escolhidos.some(
          (item) =>
            item.id === stage.id
        )
      ) {
        escolhidos.push(stage);
      }

      if (escolhidos.length === 3) {
        break;
      }
    }
  }

  return escolhidos.slice(0, 3);
}

/* =========================================================
   NUTRIENTES DISPONÍVEIS NO DEMO
   ========================================================= */

const DEMO_NUTRIENT_PATTERNS = [

  /cálcio|calcio/i,

  /ferro/i,

  /zinco/i,

  /magnésio|magnesio/i,

  /potássio|potassio/i,

  /vitamina\s*d/i,

  /vitamina\s*c/i,

  /vitamina\s*a/i,

  /folato|ácido fólico|acido folico/i,

  /vitamina\s*b12|cobalamina/i
];

function limitarMetasDemo(metas) {

  const selected = [];

  /*
   * Primeiro tenta selecionar
   * nutrientes importantes.
   */

  for (
    const regex
    of DEMO_NUTRIENT_PATTERNS
  ) {

    const found = metas.find(
      (nutriente) => {

        const nome =
          String(
            nutriente.nome || ""
          );

        return (
          regex.test(nome) &&
          !selected.some(
            (item) =>
              item.id ===
              nutriente.id
          )
        );
      }
    );

    if (found) {
      selected.push(found);
    }
  }

  /*
   * Completa até o limite de 10,
   * caso necessário.
   */

  for (const nutriente of metas) {

    if (
      selected.length >=
      DEMO_MAX_NUTRIENTES
    ) {
      break;
    }

    if (
      !selected.some(
        (item) =>
          item.id ===
          nutriente.id
      )
    ) {
      selected.push(nutriente);
    }
  }

  return selected.slice(
    0,
    DEMO_MAX_NUTRIENTES
  );
}

/* =========================================================
   API: HEALTH
   ========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      servico: "Padovani DRI API",
      versao: "2.0.0",
      modos: [
        "demo",
        "pro"
      ]
    });
  }
);

/* =========================================================
   API: LOGIN
   ========================================================= */

app.post(
  "/api/login",
  (req, res) => {

    const {
      email,
      password
    } = req.body || {};

    if (!email || !password) {

      return res.status(400).json({
        erro:
          "E-mail e senha obrigatórios."
      });
    }

    const user =
      users.find(
        (u) =>
          u.email.toLowerCase() ===
          String(email)
            .trim()
            .toLowerCase()
      );

    if (
      !user ||
      !bcrypt.compareSync(
        password,
        user.passwordHash
      )
    ) {

      return res.status(401).json({
        erro:
          "E-mail ou senha incorretos."
      });
    }

    if (!user.ativo) {

      return res.status(403).json({
        erro:
          "Conta desativada."
      });
    }

    const token =
      jwt.sign(
        {
          sub: user.id,
          email: user.email,
          plano: user.plano
        },
        JWT_SECRET,
        {
          expiresIn:
            TOKEN_EXPIRA
        }
      );

    res.json({

      token,

      usuario: {
        id: user.id,
        email: user.email,
        nome: user.nome,
        crn: user.crn,
        plano: user.plano
      },

      expiraEm:
        TOKEN_EXPIRA
    });
  }
);

/* =========================================================
   API: ME
   ========================================================= */

app.get(
  "/api/me",
  authRequired,
  (req, res) => {

    const pro =
      isProfessional(req.user);

    const usage =
      pro
        ? null
        : getDemoUsage(req);

    res.json({

      usuario:
        req.user,

      modo:
        pro
          ? "profissional"
          : "demo",

      limites:

        pro

          ? {
              calculos: null,
              nutrientesPorConsulta: null,
              estagios: "completo"
            }

          : {

              calculosRestantes:
                Math.max(
                  0,
                  DEMO_MAX_CALCULOS -
                    usage.count
                ),

              calculosMaximos:
                DEMO_MAX_CALCULOS,

              nutrientesPorConsulta:
                DEMO_MAX_NUTRIENTES,

              estagios: 3,

              condicoes: [
                "normal"
              ]
            }
    });
  }
);

/* =========================================================
   API: LISTAR ESTÁGIOS
   ========================================================= */

app.get(
  "/api/estagios",
  authRequired,
  (req, res) => {

    const sexo =
      String(
        req.query.sexo || "F"
      ).toUpperCase();

    const condicao =
      String(
        req.query.condicao ||
        "normal"
      ).toLowerCase();

    if (
      !["M", "F"].includes(sexo)
    ) {

      return res.status(400).json({
        erro:
          "sexo deve ser M ou F"
      });
    }

    if (
      ![
        "normal",
        "gestante",
        "lactante"
      ].includes(condicao)
    ) {

      return res.status(400).json({
        erro:
          "condição inválida"
      });
    }

    /*
     * DEMO
     */

    if (!isProfessional(req.user)) {

      if (
        condicao !== "normal"
      ) {

        return res.status(403).json({
          erro:
            "O modo DEMO permite somente a condição Normal. Acesso a gestante e lactante é profissional."
        });
      }

      return res.json({

        modo: "demo",

        estagios:
          listarEstagiosDemo(
            sexo
          ),

        limite: {

          estagios: 3,

          observacao:
            "Estágios limitados para demonstração."
        }
      });
    }

    /*
     * PROFISSIONAL
     */

    return res.json({

      modo:
        "profissional",

      estagios:
        listarEstagios(
          sexo,
          condicao
        )
    });
  }
);

/* =========================================================
   API: CALCULAR DRI
   ========================================================= */

app.post(
  "/api/calcular",
  authRequired,
  (req, res) => {

    const {
      stageId,
      grupo = "todos",
      pacienteNome = ""
    } = req.body || {};

    if (
      !stageId ||
      typeof stageId !==
        "string"
    ) {

      return res.status(400).json({
        erro:
          "stageId obrigatório."
      });
    }

    if (
      ![
        "todos",
        "vitaminas",
        "minerais"
      ].includes(grupo)
    ) {

      return res.status(400).json({
        erro:
          "grupo inválido."
      });
    }

    const pro =
      isProfessional(
        req.user
      );

    /* =====================================================
       REGRAS DO DEMO
       ===================================================== */

    if (!pro) {

      /*
       * Só permite estágios
       * presentes no DEMO.
       */

      const demoStages = [

        ...listarEstagiosDemo("F"),

        ...listarEstagiosDemo("M")
      ];

      const allowedStage =
        demoStages.some(
          (stage) =>
            stage.id ===
            stageId
        );

      if (!allowedStage) {

        return res.status(403).json({
          erro:
            "Este estágio não está disponível no modo DEMO. Use um dos 3 estágios de demonstração."
        });
      }

      /*
       * DEMO somente grupo todos.
       */

      if (
        grupo !== "todos"
      ) {

        return res.status(403).json({
          erro:
            "No modo DEMO, o resultado é entregue somente no conjunto demonstrativo. Vitaminas e minerais completos são recursos profissionais."
        });
      }

      /*
       * Limite de 5 cálculos.
       */

      if (
        !consumeDemoCalculation(
          req
        )
      ) {

        const usage =
          getDemoUsage(req);

        return res.status(429).json({

          erro:
            "Limite DEMO atingido: 5 cálculos por período de 24 horas.",

          calculosMaximos:
            DEMO_MAX_CALCULOS,

          calculosUsados:
            usage.count
        });
      }
    }

    /* =====================================================
       CALCULAR DADOS
       ===================================================== */

    const metasCompletas =
      calcularMetas(
        stageId,
        grupo
      );

    if (
      !metasCompletas ||
      !metasCompletas.length
    ) {

      return res.status(404).json({
        erro:
          "Estágio não encontrado ou sem dados."
      });
    }

    /*
     * Profissional recebe tudo.
     *
     * DEMO recebe somente
     * os nutrientes permitidos.
     */

    const metas =
      pro
        ? metasCompletas
        : limitarMetasDemo(
            metasCompletas
          );

    const usage =
      pro
        ? null
        : getDemoUsage(req);

    console.log(
      "[CALC]",
      "modo=" +
        (pro
          ? "pro"
          : "demo"),
      "user=" +
        req.user.email,
      "stage=" +
        stageId,
      "grupo=" +
        grupo,
      "at=" +
        new Date().toISOString()
    );

    /* =====================================================
       RESPOSTA
       ===================================================== */

    res.json({

      geradoEm:
        new Date().toISOString(),

      modo:
        pro
          ? "profissional"
          : "demo",

      profissional: {

        nome:
          req.user.nome,

        email:
          req.user.email,

        crn:
          req.user.crn,

        plano:
          req.user.plano
      },

      pacienteNome:
        String(
          pacienteNome || ""
        ).slice(0, 120) ||
        null,

      stageId,

      grupo,

      metas,

      limiteDemo:

        pro

          ? null

          : {

              calculosUsados:
                usage.count,

              calculosRestantes:
                Math.max(
                  0,
                  DEMO_MAX_CALCULOS -
                    usage.count
                ),

              nutrientesEntregues:
                metas.length,

              nutrientesMaximos:
                DEMO_MAX_NUTRIENTES
            },

      licenca:

        pro

          ? (
              "Uso profissional — " +
              req.user.nome +
              (
                req.user.crn
                  ? " · " +
                    req.user.crn
                  : ""
              )
            )

          : (
              "DEMONSTRAÇÃO — " +
              req.user.nome +
              " · resultado limitado"
            )
    });
  }
);

/* =========================================================
   ROTA PRINCIPAL
   ========================================================= */

app.get(
  "*",
  (req, res) => {

    if (publicDir) {

      return res.sendFile(
        path.join(
          publicDir,
          "index.html"
        )
      );
    }

    res
      .status(404)
      .type("html")
      .send(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Padovani DRI API V2</title>
        </head>

        <body>

          <h1>Padovani DRI API V2</h1>

          <p>
            index.html não encontrado.
          </p>

          <p>
            <a href="/api/health">
              Testar API
            </a>
          </p>

        </body>
        </html>
      `);
  }
);

/* =========================================================
   INICIAR SERVIDOR
   ========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      "========================================"
    );

    console.log(
      "Padovani DRI API V2"
    );

    console.log(
      "Servidor rodando na porta:",
      PORT
    );

    console.log(
      "========================================"
    );

    console.log(
      "DEMO:"
    );

    console.log(
      "teste@demo.com / demo123"
    );

    console.log(
      "----------------------------------------"
    );

    console.log(
      "PROFISSIONAL:"
    );

    console.log(
      "nutri@demo.com / demo123"
    );

    console.log(
      "========================================"
    );

    if (!process.env.JWT_SECRET) {

      console.warn(
        "ATENÇÃO: JWT_SECRET não foi configurado no Render."
      );

      console.warn(
        "Configure JWT_SECRET nas Environment Variables."
      );
    }
  }
);
