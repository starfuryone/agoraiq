declare module 'bullmq' {
  export class Queue {
    constructor(name: string, opts?: any);
    add(name: string, data: any, opts?: any): Promise<{ id?: string }>;
    addBulk(jobs: any[]): Promise<any>;
    close(): Promise<void>;
  }
  export class Worker {
    constructor(name: string, handler: (job: Job) => Promise<void>, opts?: any);
    on(event: string, handler: (...args: any[]) => void): void;
    close(): Promise<void>;
  }
  export class Job<T = any> {
    id?: string;
    data: T;
    name: string;
  }
  export class QueueEvents {
    constructor(name: string, opts?: any);
  }
}

declare module 'ioredis' {
  export class Redis {
    constructor(url?: string, opts?: any);
    zadd(key: string, score: number, member: string): Promise<number>;
    zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
    zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    exists(key: string): Promise<number>;
    ttl(key: string): Promise<number>;
    get(key: string): Promise<string | null>;
    setex(key: string, seconds: number, value: string): Promise<string>;
    incr(key: string): Promise<number>;
    quit(): Promise<string>;
  }
}

declare module 'web-push' {
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(subscription: any, payload: string): Promise<any>;
  const _default: { setVapidDetails: typeof setVapidDetails; sendNotification: typeof sendNotification };
  export default _default;
}

declare module 'pino' {
  function pino(opts?: any): any;
  export default pino;
}

declare module '@prisma/client' {
  export class PrismaClient {
    constructor(opts?: any);
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $queryRaw<T = any>(query: TemplateStringsArray, ...values: any[]): Promise<T>;
    $queryRawUnsafe<T = any>(query: string, ...values: any[]): Promise<T>;
    [key: string]: any;
  }
  export namespace Prisma {}
}
