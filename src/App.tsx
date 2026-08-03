import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { Layout } from './components/Layout';
import Dashboard from './pages/Dashboard';
import DataManagement from './pages/DataManagement';
import Chat from './pages/Chat';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Register from './pages/Register';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from 'next-themes';

const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) => {
  const { profile, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-sky-50/50 gap-4">
        <div className="w-12 h-12 border-4 border-[#006cb8] border-t-transparent rounded-full animate-spin" />
        <p className="text-[15px] font-extrabold text-[#006cb8] uppercase tracking-widest animate-pulse">Đang kết nối hệ thống...</p>
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }
  
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return <Layout>{children}</Layout>;
};

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            
            <Route path="/" element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } />
            
            <Route path="/data" element={
              <ProtectedRoute allowedRoles={['SALES_ADMIN', 'SYSTEM_ADMIN']}>
                <DataManagement />
              </ProtectedRoute>
            } />
            
            <Route path="/chat" element={
              <ProtectedRoute>
                <Chat />
              </ProtectedRoute>
            } />
            
            <Route path="/reports" element={
              <ProtectedRoute allowedRoles={['SALES_MANAGER', 'SYSTEM_ADMIN']}>
                <Reports />
              </ProtectedRoute>
            } />
            
            <Route path="/settings" element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            } />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </ThemeProvider>
  );
}
