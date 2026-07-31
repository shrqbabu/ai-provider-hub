import { type Auth } from "firebase-admin/auth";
import { type Firestore } from "firebase-admin/firestore";
export declare function getDb(): Firestore;
export declare function getAdminAuth(): Auth;
