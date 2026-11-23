import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import {
  doc,
  Firestore,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const MASTER_ADMIN_EMAIL = 'drc.2015kolkata@gmail.com';
export const BACKUP_ISOLATED_DRIVE_EMAIL = 'drc.2015kolkata@gmail.com';
export const OFFICIAL_PARTY_EMAIL = 'drc.kolkata1@gmail.com';
export const VERCEL_APP_DOMAIN = 'dolphin-road-carrier.vercel.app';

export function isAuthorizedBackupDriveEmail(email?: string | null): boolean {
  const clean = String(email || '').trim().toLowerCase();
  return clean === MASTER_ADMIN_EMAIL.toLowerCase();
}
export const ALLOWLISTED_OAUTH_DOMAINS = [
  VERCEL_APP_DOMAIN,
  'dolphin-road-carrier.firebaseapp.com',
  'dolphin-road-carrier.web.app',
  'localhost',
  '127.0.0.1',
] as const;

export function getOAuthDomainStatus(): {
  hostname: string;
  origin: string;
  isVercelProduction: boolean;
  isAllowlistedHost: boolean;
  authDomain: string;
} {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : VERCEL_APP_DOMAIN;
  const origin = typeof window !== 'undefined' ? window.location.origin : `https://${VERCEL_APP_DOMAIN}`;
  const isVercelProduction = hostname === VERCEL_APP_DOMAIN || hostname.endsWith('.vercel.app');
  const isAllowlistedHost =
    ALLOWLISTED_OAUTH_DOMAINS.some((d) => hostname === d) ||
    hostname.endsWith('.vercel.app') ||
    hostname.endsWith('.firebaseapp.com') ||
    hostname.endsWith('.web.app') ||
    hostname.endsWith('.run.app');
  return {
    hostname,
    origin,
    isVercelProduction,
    isAllowlistedHost,
    authDomain: String((firebaseConfig as { authDomain?: string }).authDomain || `${firebaseConfig.projectId}.firebaseapp.com`),
  };
}

const app = initializeApp(firebaseConfig);
const firestoreDbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

function createConcurrentFirestore(): Firestore {
  try {
    const cacheConfig = {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    };
    return firestoreDbId
      ? initializeFirestore(app, cacheConfig, firestoreDbId)
      : initializeFirestore(app, cacheConfig);
  } catch {
    // Already initialized (e.g., module reload) -> reuse active Firestore instance
    return firestoreDbId ? getFirestore(app, firestoreDbId) : getFirestore(app);
  }
}

export const db = createConcurrentFirestore();
export const auth = getAuth(app);

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let connectedGmailEmail: string | null = null;

function createProvider(forceSelectAccount = false): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);
  provider.addScope(DRIVE_APPDATA_SCOPE);
  provider.setCustomParameters({
    login_hint: MASTER_ADMIN_EMAIL,
    ...(forceSelectAccount ? { prompt: 'select_account' } : {}),
  });
  return provider;
}

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
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  if (!auth.currentUser) {
    return true;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

export function initAuth(
  onAuthChange: (user: User | null, accessToken: string | null) => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
      connectedGmailEmail = null;
      onAuthChange(null, null);
      return;
    }
    if (!isSigningIn) {
      onAuthChange(user, cachedAccessToken);
    }
  });
}

export async function googleSignIn(forceAccountSelect = false): Promise<{
  user: User;
  accessToken: string | null;
}> {
  try {
    isSigningIn = true;
    const provider = createProvider(forceAccountSelect);
    const result = await signInWithPopup(auth, provider);
    const signedEmail = (result.user.email || '').trim().toLowerCase();
    if (!isAuthorizedBackupDriveEmail(signedEmail)) {
      cachedAccessToken = null;
      connectedGmailEmail = null;
      await auth.signOut().catch(() => {});
      throw new Error(
        `Drive Sync/Restore Blocked: Authorized strictly for ${MASTER_ADMIN_EMAIL} (attempted: ${result.user.email || 'unknown account'}).`
      );
    }
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken ?? null;
    connectedGmailEmail = result.user.email ?? null;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
      throw new Error(
        'Google popup was blocked by this preview window. Open the app in a full browser tab to authorize Google Drive.'
      );
    }
    if (code === 'auth/unauthorized-domain') {
      const host = typeof window !== 'undefined' ? window.location.hostname : VERCEL_APP_DOMAIN;
      throw new Error(
        `Domain "${host}" is not yet authorized in Firebase Console → Authentication → Settings → Authorized domains. Add "${VERCEL_APP_DOMAIN}" (and "${host}") to Firebase Authorized Domains, or use Export Local JSON.`
      );
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
}

export function getAccessToken(): string | null {
  return cachedAccessToken;
}

export function getConnectedGmail(): string | null {
  return connectedGmailEmail || auth.currentUser?.email || null;
}

export async function logoutGoogle(): Promise<void> {
  await auth.signOut();
  cachedAccessToken = null;
  connectedGmailEmail = null;
}
