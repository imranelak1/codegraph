// A CommonJS module in an otherwise-ESM project. codeGraph reads both.
const { logger } = require("./util/logger");
const path = require("node:path");

function legacyBoot() {
  logger.info("legacy boot on " + path.sep);
}

module.exports = { legacyBoot };
