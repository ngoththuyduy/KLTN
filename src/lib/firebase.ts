import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { toast } from 'sonner';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

const firestoreConfig: any = {
  experimentalForceLongPolling: true,
};

// Handle optional specific databaseId from config
const dbId = (firebaseConfig as any).firestoreDatabaseId;
if (dbId) {
  firestoreConfig.databaseId = dbId;
}

export const db = initializeFirestore(app, firestoreConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const rawMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: rawMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.warn('Firestore Operation Notice: ', JSON.stringify(errInfo));

  // If it's permission-denied or network drop, suppress toast as fallback mechanism handles it smoothly
  if (rawMsg.includes("Missing or insufficient permissions") || rawMsg.includes("permission-denied")) {
    console.info("Notice: Firestore permission check bypassed gracefully.");
    return;
  }

  if (rawMsg.includes("Unavailable") || rawMsg.includes("offline")) {
    console.info("Notice: Firestore offline mode active.");
    return;
  }

  toast.error(rawMsg, { duration: 4000 });
}
