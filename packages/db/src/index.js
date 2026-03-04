"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.PrismaClient = exports.rootLogger = exports.createLogger = void 0;
const client_1 = require("@prisma/client");
var logger_1 = require("./logger");
Object.defineProperty(exports, "createLogger", { enumerable: true, get: function () { return logger_1.createLogger; } });
Object.defineProperty(exports, "rootLogger", { enumerable: true, get: function () { return logger_1.rootLogger; } });
var client_2 = require("@prisma/client");
Object.defineProperty(exports, "PrismaClient", { enumerable: true, get: function () { return client_2.PrismaClient; } });
// Singleton PrismaClient (prevents connection exhaustion in dev)
const globalForPrisma = globalThis;
exports.db = globalForPrisma.prisma ??
    new client_1.PrismaClient({
        log: process.env.NODE_ENV === 'development'
            ? ['query', 'error', 'warn']
            : ['error'],
    });
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = exports.db;
}
//# sourceMappingURL=index.js.map