#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/mcp/env.ts
import { existsSync, readFileSync } from "fs";
function stripOptionalQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" || trimmed[trimmed.length - 1] !== quote) {
    return trimmed;
  }
  const unquoted = trimmed.slice(1, -1);
  if (quote === "'") {
    return unquoted;
  }
  return unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "	").replace(/\\"/g, '"');
}
function loadEnvFile(path = process.env.MACROFACTOR_MCP_ENV_FILE ?? ".env") {
  if (!existsSync(path)) {
    return;
  }
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }
    const key = assignment.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== void 0) {
      continue;
    }
    process.env[key] = stripOptionalQuotes(assignment.slice(separatorIndex + 1));
  }
}

export {
  __commonJS,
  __export,
  __toESM,
  loadEnvFile
};
//# sourceMappingURL=chunk-HESKLNRG.js.map