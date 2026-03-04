"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rootLogger = void 0;
exports.createLogger = createLogger;
const pino_1 = __importDefault(require("pino"));
const rootLogger = (0, pino_1.default)({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
});
exports.rootLogger = rootLogger;
function createLogger(name) {
    return rootLogger.child({ module: name });
}
//# sourceMappingURL=logger.js.map