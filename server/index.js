/**
 * Padovani DRI API V2
 * Modo DEMO + Modo PROFISSIONAL
 *
 * As tabelas completas DRI permanecem em:
 * server/data/dri.js
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

const DEMO_MAX_CALCULOS = 5;
const DEMO_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEMO_MAX_NUTRIENTES = 10;
