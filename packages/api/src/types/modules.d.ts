declare module 'zod' {
  export function object(shape: any): any;
  export function string(): any;
  export function number(): any;
  export function boolean(): any;
  export function array(schema: any): any;
  export function literal(value: any): any;
  export function discriminatedUnion(key: string, schemas: any[]): any;
  export function enum_(values: readonly string[]): any;
  export { enum_ as enum };
  export const z: any;
  export default z;
}

declare module 'bullmq' {
  export class Queue { constructor(name: string, opts?: any); }
  export class Worker {
    constructor(name: string, handler: any, opts?: any);
    on(event: string, handler: any): void;
    close(): Promise<void>;
  }
  export class Job<T = any> { id?: string; data: T; name: string; }
  export class QueueEvents { constructor(name: string, opts?: any); }
}

declare module 'ioredis' {
  export class Redis { constructor(url?: string, opts?: any); quit(): Promise<string>; [k: string]: any; }
}
