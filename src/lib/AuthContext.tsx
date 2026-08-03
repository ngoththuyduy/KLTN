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

const DEFAULT_PRIMARY_PROFILE: UserProfile = {
  id: 'user_ngoththuyduy_default',
  email: 'ngoththuyduy@gmail.com',
  fullName: 'Thủy Duy Ngô',
  role: 'SYSTEM_ADMIN',
  status: 'ACTIVE',
  createdAt: new Date().toISOString()
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<UserProfile>(() => {
    const storedSession = localStorage.getItem('sales_intel_active_user');
    if (storedSession) {
      try {
        return JSON.parse(storedSession);
      } catch (err) {
        console.error("Local session format invalid", err);
      }
    }
    return DEFAULT_PRIMARY_PROFILE;
  });

  const [user, setUser] = useState<User | null>(() => {
    const storedSession = localStorage.getItem('sales_intel_active_user');
    let p = DEFAULT_PRIMARY_PROFILE;
    if (storedSession) {
      try {
        p = JSON.parse(storedSession);
      } catch (e) {}
    }
    return {
      uid: p.id,
      email: p.email,
      displayName: p.fullName,
      emailVerified: true,
    } as unknown as User;
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      // If there is currently a bypass session, let's keep it
      if (localStorage.getItem('sales_intel_active_user')) return;

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
            setProfile(profileData);
            setLoading(false);
          } else {
            // Keep active session profile if stored or default
            setLoading(false);
          }
        }, (error) => {
          console.warn("Firestore profile subscription failure:", error);
          setLoading(false);
        });
      } else {
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
    const demoProfile: UserProfile = {
      id: 'demo_user_bypass',
      email: 'demo.user@salesintel.internal',
      fullName: fullName || 'Demo User',
      role: role,
      status: 'ACTIVE',
      createdAt: new Date()
    };
    localStorage.setItem('sales_intel_active_user', JSON.stringify(demoProfile));
    setUser({
      uid: demoProfile.id,
      email: demoProfile.email,
      displayName: demoProfile.fullName,
      emailVerified: true,
    } as unknown as User);
    setProfile(demoProfile);
  };

  const loginWithProfile = (customProfile: UserProfile) => {
    localStorage.setItem('sales_intel_active_user', JSON.stringify(customProfile));
    setUser({
      uid: customProfile.id,
      email: customProfile.email,
      displayName: customProfile.fullName,
      emailVerified: true,
    } as unknown as User);
    setProfile(customProfile);
  };

  const selectRole = (role: UserRole) => {
    const currentProfile = profile || {
      id: 'default_manager_bypass',
      email: 'demo.user@salesintel.internal',
      fullName: 'Người dùng Thử nghiệm',
      role: 'SYSTEM_ADMIN' as UserRole,
      status: 'ACTIVE' as const,
      createdAt: new Date().toISOString()
    };
    const updated = { ...currentProfile, role };
    localStorage.setItem('sales_intel_active_user', JSON.stringify(updated));
    setProfile(updated);
    toast.success(`Đã chuyển sang vai trò: ${
      role === 'SYSTEM_ADMIN' ? 'Quản trị viên Hệ thống' : 
      role === 'SALES_ADMIN' ? 'Quản trị viên Kinh doanh' : 'Giám đốc Kinh doanh'
    }`);
  };

  const logout = async () => {
    localStorage.removeItem('sales_intel_active_user');
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
