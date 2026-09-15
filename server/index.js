const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const {
  calcularMetas,
  listarEstagios
} = require('./data/dri');

const app = express();

app.set('trust proxy', 1);

const PORT = process.env.PORT || 3847;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'mude-este-segredo-em-producao-padovani-2026';

const TOKEN_EXPIRA = '12h';

const DEMO_MAX_CALCULOS = 3;
const DEMO_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEMO_MAX_NUTRIENTES = 10;


/* =========================================================
   USUÁRIOS DE TESTE
========================================================= */

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
    nome: 'Usuário Demo',
    crn: null,
    passwordHash: bcrypt.hashSync('demo123', 10),
    plano: 'demo',
    ativo: true
  }

];


/* =========================================================
   RATE LIMIT
========================================================= */

const hits = new Map();

function rateLimit(req, res, next) {

  const ip =
    req.ip ||
    req.connection.remoteAddress ||
    'unknown';

  const now = Date.now();

  const windowMs = 60 * 1000;
  const max = 60;

  let entry = hits.get(ip);

  if (
    !entry ||
    now - entry.start > windowMs
  ) {

    entry = {
      start: now,
      count: 0
    };

    hits.set(ip, entry);
  }

  entry.count++;

  if (entry.count > max) {

    return res.status(429).json({
      erro: 'Muitas requisições. Aguarde um minuto.'
    });

  }

  next();
}


/* =========================================================
   CONFIGURAÇÃO
========================================================= */

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(
  express.json({
    limit: '32kb'
  })
);

app.use(rateLimit);


/* =========================================================
   FRONTEND
========================================================= */

const publicCandidates = [

  path.join(__dirname, 'public'),

  path.join(__dirname, '../public'),

  path.join(__dirname, '..')

];

const publicDir =
  publicCandidates.find(
    d =>
      fs.existsSync(
        path.join(d, 'index.html')
      )
  );

if (publicDir) {

  app.use(
    express.static(publicDir)
  );

  console.log(
    'Servindo front de:',
    publicDir
  );

} else {

  console.warn(
    'AVISO: index.html não encontrado.'
  );

}


/* =========================================================
   PROFISSIONAL
========================================================= */

function isProfessional(user) {

  return user &&
    (
      user.plano === 'pro' ||
      user.plano === 'profissional'
    );

}


/* =========================================================
   AUTENTICAÇÃO
========================================================= */

function authRequired(req, res, next) {

  const header =
    req.headers.authorization || '';

  const token =
    header.startsWith('Bearer ')
      ? header.slice(7)
      : null;

  if (!token) {

    return res.status(401).json({
      erro: 'Login necessário.'
    });

  }

  try {

    const payload =
      jwt.verify(
        token,
        JWT_SECRET
      );

    const user =
      users.find(
        u =>
          u.id === payload.sub &&
          u.ativo
      );

    if (!user) {

      return res.status(401).json({
        erro: 'Sessão inválida.'
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

  } catch {

    return res.status(401).json({
      erro:
        'Token expirado ou inválido. Faça login novamente.'
    });

  }

}


/* =========================================================
   CONTROLE DEMO
========================================================= */

const demoUsage = new Map();

function demoKey(req) {

  return (
    String(req.user.id) +
    ':' +
    (req.ip || 'unknown')
  );

}


function getDemoUsage(req) {

  const key =
    demoKey(req);

  const now =
    Date.now();

  let entry =
    demoUsage.get(key);

  if (
    !entry ||
    now - entry.startedAt >= DEMO_WINDOW_MS
  ) {

    entry = {

      startedAt: now,

      count: 0

    };

    demoUsage.set(
      key,
      entry
    );

  }

  return entry;

}


function consumeDemoCalculation(req) {

  const entry =
    getDemoUsage(req);

  if (
    entry.count >=
    DEMO_MAX_CALCULOS
  ) {

    return false;

  }

  entry.count++;

  return true;

}


/* =========================================================
   ESTÁGIOS DEMO
========================================================= */

function listarEstagiosDemo(sexo) {

  const todos =
    listarEstagios(
      sexo,
      'normal'
    ) || [];

  const wanted = [

    /19\s*[–-]\s*30/i,

    /31\s*[–-]\s*50/i,

    /51\s*[–-]\s*70/i

  ];

  const escolhidos = [];

  for (const rx of wanted) {

    const found =
      todos.find(
        s =>
          rx.test(
            String(
              s.label || ''
            )
          )
      );

    if (
      found &&
      !escolhidos.some(
        x => x.id === found.id
      )
    ) {

      escolhidos.push(found);

    }

  }


  /*
   Fallback caso os nomes das
   faixas sejam diferentes.
  */

  if (
    escolhidos.length < 3
  ) {

    for (const s of todos) {

      if (
        !escolhidos.some(
          x => x.id === s.id
        )
      ) {

        escolhidos.push(s);

      }

      if (
        escolhidos.length === 3
      ) {

        break;

      }

    }

  }

  return escolhidos.slice(0, 3);

}


/* =========================================================
   NUTRIENTES DEMO
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

  for (
    const rx
    of DEMO_NUTRIENT_PATTERNS
  ) {

    const found =
      metas.find(
        n =>

          rx.test(
            String(
              n.nome || ''
            )
          ) &&

          !selected.some(
            x => x.id === n.id
          )
      );

    if (found) {

      selected.push(found);

    }

  }


  for (const n of metas) {

    if (
      selected.length >=
      DEMO_MAX_NUTRIENTES
    ) {

      break;

    }

    if (
      !selected.some(
        x => x.id === n.id
      )
    ) {

      selected.push(n);

    }

  }

  return selected.slice(
    0,
    DEMO_MAX_NUTRIENTES
  );

}


/* =========================================================
   HEALTH
========================================================= */

app.get(
  '/api/health',
  (_req, res) => {

    res.json({

      ok: true,

      servico:
        'Padovani DRI API',

      versao:
        '2.0.0',

      modos: [
        'demo',
        'pro'
      ]

    });

  }
);


/* =========================================================
   LOGIN
========================================================= */

app.post(
  '/api/login',
  (req, res) => {

    const {
      email,
      password
    } = req.body || {};

    if (
      !email ||
      !password
    ) {

      return res.status(400).json({
        erro:
          'E-mail e senha obrigatórios.'
      });

    }


    const user =
      users.find(
        u =>
          u.email
            .toLowerCase() ===
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
          'E-mail ou senha incorretos.'
      });

    }


    if (!user.ativo) {

      return res.status(403).json({
        erro:
          'Conta desativada.'
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
   MINHA CONTA
========================================================= */

app.get(
  '/api/me',
  authRequired,
  (req, res) => {

    const isPro =
      isProfessional(
        req.user
      );

    const usage =
      isPro
        ? null
        : getDemoUsage(req);


    res.json({

      usuario:
        req.user,

      modo:
        isPro
          ? 'profissional'
          : 'demo',

      limites:

        isPro

          ? {

              calculos: null,

              nutrientesPorConsulta:
                null,

              estagios:
                'completo'

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

              estagios:
                3,

              condicoes:
                ['normal']

            }

    });

  }
);


/* =========================================================
   ESTÁGIOS
========================================================= */

app.get(
  '/api/estagios',
  authRequired,
  (req, res) => {

    const sexo =
      String(
        req.query.sexo || 'F'
      ).toUpperCase();

    const condicao =
      String(
        req.query.condicao ||
        'normal'
      ).toLowerCase();


    if (
      !['M', 'F'].includes(sexo)
    ) {

      return res.status(400).json({
        erro:
          'sexo deve ser M ou F'
      });

    }


    if (
      ![
        'normal',
        'gestante',
        'lactante'
      ].includes(condicao)
    ) {

      return res.status(400).json({
        erro:
          'condição inválida'
      });

    }


    /*
     DEMO
    */

    if (
      !isProfessional(req.user)
    ) {

      if (
        condicao !== 'normal'
      ) {

        return res.status(403).json({

          erro:
            'O modo DEMO permite somente a condição Normal. Acesso a gestante e lactante é profissional.'

        });

      }


      return res.json({

        modo: 'demo',

        estagios:
          listarEstagiosDemo(
            sexo
          ),

        limite: {

          estagios: 3,

          observacao:
            'Estágios limitados para demonstração.'

        }

      });

    }


    /*
     PROFISSIONAL
    */

    return res.json({

      modo:
        'profissional',

      estagios:
        listarEstagios(
          sexo,
          condicao
        )

    });

  }
);


/* =========================================================
   CALCULAR
========================================================= */

app.post(
  '/api/calcular',
  authRequired,
  (req, res) => {

    const {
      stageId,
      grupo = 'todos',
      pacienteNome = ''
    } = req.body || {};


    if (
      !stageId ||
      typeof stageId !== 'string'
    ) {

      return res.status(400).json({
        erro:
          'stageId obrigatório.'
      });

    }


    if (
      ![
        'todos',
        'vitaminas',
        'minerais'
      ].includes(grupo)
    ) {

      return res.status(400).json({
        erro:
          'grupo inválido.'
      });

    }


    const pro =
      isProfessional(
        req.user
      );


    /*
     REGRAS DEMO
    */

    if (!pro) {

      const demoStages = [

        ...listarEstagiosDemo('F'),

        ...listarEstagiosDemo('M')

      ];


      const allowedStage =
        demoStages.some(
          s =>
            s.id === stageId
        );


      if (!allowedStage) {

        return res.status(403).json({

          erro:
            'Este estágio não está disponível no modo DEMO. Use um dos 3 estágios de demonstração.'

        });

      }


      if (
        grupo !== 'todos'
      ) {

        return res.status(403).json({

          erro:
            'No modo DEMO, o resultado é entregue somente no conjunto demonstrativo. Vitaminas e minerais completos são recursos profissionais.'

        });

      }


      if (
        !consumeDemoCalculation(req)
      ) {

        const usage =
          getDemoUsage(req);


        return res.status(429).json({

          erro:
            'Limite DEMO atingido: 3 cálculos por período de 24 horas.',

          calculosMaximos:
            DEMO_MAX_CALCULOS,

          calculosUsados:
            usage.count

        });

      }

    }


    /*
     CALCULA OS DADOS
    */

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
          'Estágio não encontrado ou sem dados.'

      });

    }


    /*
     PROFISSIONAL recebe tudo.
     DEMO recebe somente 10.
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

      `[CALC] modo=${
        pro ? 'pro' : 'demo'
      } ` +

      `user=${req.user.email} ` +

      `stage=${stageId} ` +

      `grupo=${grupo} ` +

      `at=${new Date().toISOString()}`

    );


    res.json({

      geradoEm:
        new Date().toISOString(),

      modo:
        pro
          ? 'profissional'
          : 'demo',

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
          pacienteNome || ''
        ).slice(
          0,
          120
        ) || null,

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

          ? `Uso profissional — ${req.user.nome}${
              req.user.crn
                ? ' · ' + req.user.crn
                : ''
            }`

          : `DEMONSTRAÇÃO — ${req.user.nome} · resultado limitado`

    });

  }
);


/* =========================================================
   FRONTEND — FALLBACK
========================================================= */

app.use(
  (req, res) => {

    if (publicDir) {

      return res.sendFile(
        path.join(
          publicDir,
          'index.html'
        )
      );

    }


    res.status(404).send(
      '<h1>Padovani DRI API V2</h1>' +
      '<p>index.html não encontrado.</p>' +
      '<p>API funcionando.</p>'
    );

  }
);


/* =========================================================
   SERVIDOR
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `Padovani DRI API V2 rodando em http://localhost:${PORT}`
    );

    console.log(
      'DEMO: teste@demo.com / demo123'
    );

    console.log(
      'PROFISSIONAL: nutri@demo.com / demo123'
    );


    if (
      !process.env.JWT_SECRET
    ) {

      console.warn(
        'ATENÇÃO: defina JWT_SECRET no Render para produção.'
      );

    }

  }
);
