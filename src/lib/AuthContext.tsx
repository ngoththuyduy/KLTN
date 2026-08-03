import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { UserProfile, UserRole } from '../types';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  logout: () => Promise<void>;
  loginAsDemo: (fullName: string, role: UserRole) => void;
  loginWithProfile: (customProfile: UserProfile) => void;
  selectRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const DEMO_AUTH_ENABLED = (import.meta as any).env?.VITE_ENABLE_DEMO_AUTH !== 'false';
const ACTIVE_DEMO_SESSION_KEY = 'sales_intel_active_demo_user';
const LEGACY_ACTIVE_USER_KEY = 'sales_intel_active_user';
const DEMO_SESSION_VERSION = 2;

function isDemoProfile(profile: any): profile is UserProfile {
  return Boolean(profile?.id && String(profile.id).startsWith('demo_'));
}

function removeMatchingStorageKeys(storage: Storage, shouldRemove: (key: string) => boolean) {
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key && shouldRemove(key)) {
      storage.removeItem(key);
    }
  }
}

function getActiveDemoProfile(): UserProfile | null {
  try {
    const legacy = localStorage.getItem(LEGACY_ACTIVE_USER_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (isDemoProfile(parsed)) {
        localStorage.removeItem(LEGACY_ACTIVE_USER_KEY);
      }
    }
  } catch {
    localStorage.removeItem(LEGACY_ACTIVE_USER_KEY);
  }

  const storedSession = sessionStorage.getItem(ACTIVE_DEMO_SESSION_KEY);
  if (!storedSession) return null;
  try {
    const parsed = JSON.parse(storedSession);
    if (!isDemoProfile(parsed) || (parsed as any).demoIsolationVersion !== DEMO_SESSION_VERSION) {
      sessionStorage.removeItem(ACTIVE_DEMO_SESSION_KEY);
      clearLegacyDemoStorage();
      return null;
    }
    return parsed;
  } catch (err) {
    console.error('Demo session format invalid', err);
    sessionStorage.removeItem(ACTIVE_DEMO_SESSION_KEY);
    return null;
  }
}

function clearLegacyDemoStorage() {
  const demoKeyPrefixes = [
    'sales_intel_chat_sessions',
    'sales_intel_chat_msgs_',
    'sales_intel_uploaded_files',
    'sales_intel_records_',
    'sales_intel_deleted_file_ids',
    'sales_intel_reports'
  ];

  removeMatchingStorageKeys(localStorage, (key) => {
    return demoKeyPrefixes.some(prefix => key.startsWith(prefix)) && key.includes('demo_');
  });
  localStorage.removeItem(LEGACY_ACTIVE_USER_KEY);
}

function clearCurrentDemoSessionStorage() {
  const sessionPrefixes = [
    ACTIVE_DEMO_SESSION_KEY,
    'sales_intel_chat_sessions',
    'sales_intel_chat_msgs_',
    'sales_intel_uploaded_files',
    'sales_intel_records_',
    'sales_intel_deleted_file_ids',
    'sales_intel_reports'
  ];

  removeMatchingStorageKeys(sessionStorage, (key) => {
    return sessionPrefixes.some(prefix => key.startsWith(prefix));
  });
}

function buildDemoUser(profile: UserProfile): User {
  return {
    uid: profile.id,
    email: profile.email,
    displayName: profile.fullName,
    emailVerified: true,
  } as unknown as User;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    if (!DEMO_AUTH_ENABLED) return null;
    return getActiveDemoProfile();
  });

  const [user, setUser] = useState<User | null>(() => {
    if (!DEMO_AUTH_ENABLED) return null;
    const demoProfile = getActiveDemoProfile();
    return demoProfile ? buildDemoUser(demoProfile) : null;
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      if (DEMO_AUTH_ENABLED && getActiveDemoProfile()) {
        setLoading(false);
        return;
      }

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      setUser(u);
      if (u) {
        const docRef = doc(db, 'users', u.uid);
        unsubscribeProfile = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            const profileData = {
              id: docSnap.id,
              ...docSnap.data()
            } as UserProfile;
            setProfile(profileData.status === 'ACTIVE' ? profileData : null);
          } else {
            setProfile(null);
          }
          setLoading(false);
        }, (error) => {
          console.warn('Firestore profile subscription failure:', error);
          setProfile(null);
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  const loginAsDemo = (fullName: string, role: UserRole) => {
    if (!DEMO_AUTH_ENABLED) {
      toast.error('Demo auth is disabled in this environment.');
      return;
    }

    const demoId = `demo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    clearLegacyDemoStorage();
    clearCurrentDemoSessionStorage();
    const demoProfile: UserProfile = {
      id: demoId,
      email: 'demo.user@salesintel.internal',
      fullName: fullName || 'Demo User',
      role,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      sessionStartedAt: new Date().toISOString(),
      demoIsolationVersion: DEMO_SESSION_VERSION
    } as UserProfile;
    sessionStorage.setItem(ACTIVE_DEMO_SESSION_KEY, JSON.stringify(demoProfile));
    localStorage.removeItem(LEGACY_ACTIVE_USER_KEY);
    setUser(buildDemoUser(demoProfile));
    setProfile(demoProfile);
    setLoading(false);
  };

  const loginWithProfile = (customProfile: UserProfile) => {
    let nextProfile = customProfile;
    if (DEMO_AUTH_ENABLED && customProfile.id.startsWith('demo_')) {
      clearLegacyDemoStorage();
      const demoProfile = {
        ...customProfile,
        sessionStartedAt: (customProfile as any).sessionStartedAt || new Date().toISOString(),
        demoIsolationVersion: DEMO_SESSION_VERSION
      } as UserProfile;
      nextProfile = demoProfile;
      sessionStorage.setItem(ACTIVE_DEMO_SESSION_KEY, JSON.stringify(demoProfile));
      localStorage.removeItem(LEGACY_ACTIVE_USER_KEY);
    }
    setUser(buildDemoUser(nextProfile));
    setProfile(nextProfile.status === 'ACTIVE' ? nextProfile : null);
    setLoading(false);
  };

  const selectRole = (role: UserRole) => {
    if (!DEMO_AUTH_ENABLED) {
      toast.error('Role switching is only available in demo mode.');
      return;
    }
    if (!profile) return;

    const updated = { ...profile, role };
    sessionStorage.setItem(ACTIVE_DEMO_SESSION_KEY, JSON.stringify(updated));
    localStorage.removeItem(LEGACY_ACTIVE_USER_KEY);
    setProfile(updated);
    toast.success(`Đã chuyển sang vai trò: ${
      role === 'SYSTEM_ADMIN' ? 'Quản trị viên Hệ thống' :
      role === 'SALES_ADMIN' ? 'Quản trị viên Kinh doanh' : 'Giám đốc Kinh doanh'
    }`);
  };

  const logout = async () => {
    sessionStorage.removeItem(ACTIVE_DEMO_SESSION_KEY);
    localStorage.removeItem(LEGACY_ACTIVE_USER_KEY);
    await auth.signOut();
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, logout, loginAsDemo, loginWithProfile, selectRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
