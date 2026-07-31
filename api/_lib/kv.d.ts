export declare function readKV<T>(uid: string, key: string, fallback: T): Promise<T>;
export declare function writeKV(uid: string, key: string, value: unknown, nowMs: number): Promise<void>;
export declare function deleteKV(uid: string, key: string): Promise<void>;
