import http from "node:http";
import express from "express";
import { connect } from "@app/db";
import type { Config } from "@app/config";

export function createServer(cfg: Config) {
  const app = express();
  connect(cfg.dbUrl);
  return http.createServer(app);
}
