import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { 
  Sparkles, 
  ShieldCheck, 
  Terminal, 
  User as UserIcon, 
  Lock, 
  Mail,
  ChevronDown,
  ArrowLeft
} from 'lucide-react';
import { toast } from 'sonner';
import { auth, db } from '../lib/firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { UserRole, UserProfile } from '../types';

export default function Register() {
  const navigate = useNavigate();
  const { loginWithProfile } = useAuth();
  
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('SALES_ADMIN');
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast.error("Mật khẩu xác nhận không khớp!");
      return;
    }

    if (password.length < 6) {
      toast.error("Mật khẩu phải có ít nhất 6 ký tự!");
      return;
    }

    setLoading(true);
    try {
      // 1. Create user in Firebase Authentication
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. Prepare user profile data
      const newProfile: UserProfile = {
        id: user.uid,
        email: email,
        fullName: fullName,
        role: selectedRole,
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      };

      // 3. Write user profile to Firestore
      await setDoc(doc(db, 'users', user.uid), {
        id: newProfile.id,
        email: newProfile.email,
        fullName: newProfile.fullName,
        role: newProfile.role,
        status: newProfile.status,
        createdAt: serverTimestamp()
      });

      // 4. Log in locally
      loginWithProfile(newProfile);
      
      toast.success("Đăng ký tài khoản thành công!");
      navigate('/');
    } catch (error: any) {
      console.error("Registration error:", error);
      let errorMsg = "Không thể đăng ký tài khoản. Vui lòng thử lại.";
      if (error.code === 'auth/email-already-in-use') {
        errorMsg = "Email này đã được sử dụng bởi một tài khoản khác!";
      } else if (error.code === 'auth/invalid-email') {
        errorMsg = "Địa chỉ email không hợp lệ!";
      } else if (error.code === 'auth/weak-password') {
        errorMsg = "Mật khẩu quá yếu! Vui lòng chọn mật khẩu mạnh hơn.";
      }
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-sky-50/40 p-4 md:p-8 select-none font-sans">
      {/* Outer shadow card container */}
      <div className="w-full max-w-[1100px] h-auto min-h-[640px] bg-white rounded-[2.5rem] shadow-[0_25px_60px_-15px_rgba(0,120,220,0.15)] overflow-hidden border border-sky-100/50 grid grid-cols-1 md:grid-cols-2">
        
        {/* Left Side: Brand Visual Panel (Blue Background) */}
        <div className="relative bg-gradient-to-b from-[#0091ea] to-[#0060b0] p-10 md:p-14 flex flex-col justify-between overflow-hidden text-white">
          
          {/* Subtle background bar chart visual */}
          <div className="absolute right-8 top-12 opacity-15 w-44 h-44 pointer-events-none">
            <svg viewBox="0 0 100 100" fill="none" className="w-full h-full stroke-white stroke-[4] stroke-round">
              <path d="M10 90 L90 90" />
              <path d="M25 90 L25 50" />
              <path d="M45 90 L45 30" />
              <path d="M65 90 L65 15" />
              <path d="M85 90 L85 45" />
            </svg>
          </div>

          {/* Top spark star icon */}
          <div className="relative z-10">
            <Link to="/login" className="inline-flex items-center gap-2 text-sky-100 hover:text-white font-bold text-sm transition-colors group">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              Quay lại đăng nhập
            </Link>
          </div>

          {/* Core Content */}
          <div className="relative z-10 mt-12 md:mt-0">
            <div className="w-16 h-16 rounded-3xl bg-white/15 flex items-center justify-center shadow-lg backdrop-blur-md mb-6">
              <Sparkles className="w-8 h-8 text-white fill-white/10" />
            </div>
            <h1 className="text-[38px] md:text-[44px] font-black tracking-tight leading-[1.1] mb-6 drop-shadow-xs">
              Đăng Ký Thành Viên<br />Sales Intel
            </h1>
            <p className="text-[15px] md:text-[16px] text-sky-100/90 leading-relaxed font-medium font-sans">
              Tạo tài khoản mới để sở hữu ngay Trợ lý AI phân tích doanh thu bán hàng thông minh.
            </p>
          </div>

          {/* Bottom Badges */}
          <div className="relative z-10 space-y-4 mt-12 md:mt-0">
            <div className="flex items-center gap-3.5 bg-white/10 border border-white/10 rounded-2xl py-3 px-5 backdrop-blur-md shadow-xs">
              <ShieldCheck className="w-5.5 h-5.5 text-sky-100 shrink-0" />
              <span className="text-[13px] font-bold tracking-wider uppercase">BẢO MẬT ĐA TẦNG ENTERPRISE</span>
            </div>
            
            <div className="flex items-center gap-3.5 bg-white/10 border border-white/10 rounded-2xl py-3 px-5 backdrop-blur-md shadow-xs">
              <Terminal className="w-5.5 h-5.5 text-sky-100 shrink-0" />
              <span className="text-[13px] font-bold tracking-wider uppercase">AI TRỢ LÝ PHÂN TÍCH TỨC THÌ</span>
            </div>
          </div>

          {/* Ambient lighting effect in bottom corner */}
          <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        </div>

        {/* Right Side: Interactive Registration Form Panel */}
        <div className="p-10 md:p-14 flex flex-col justify-between bg-white text-slate-800">
          
          {/* Header */}
          <div className="text-center md:text-left mt-2">
            <h2 className="text-[32px] md:text-[36px] font-black text-slate-900 tracking-tight leading-tight">
              Tạo tài khoản mới
            </h2>
            <p className="text-[15px] text-slate-500 font-medium mt-2 leading-relaxed">
              Điền các thông tin dưới đây để đăng ký.
            </p>
          </div>

          {/* Form Content */}
          <div className="my-6">
            <form onSubmit={handleRegister} className="space-y-4">
              
              {/* Full Name Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 ml-1">
                  <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                  HỌ VÀ TÊN
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  className="w-full h-11 px-4 rounded-2xl bg-slate-50 border border-slate-200 text-[14px] font-bold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:border-sky-400 focus:ring-2 focus:ring-sky-100/50 transition-all duration-200"
                />
              </div>

              {/* Email Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 ml-1">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  EMAIL ĐĂNG KÝ
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@salesintel.com"
                  className="w-full h-11 px-4 rounded-2xl bg-slate-50 border border-slate-200 text-[14px] font-bold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:border-sky-400 focus:ring-2 focus:ring-sky-100/50 transition-all duration-200"
                />
              </div>

              {/* Password Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 ml-1">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  MẬT KHẨU
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự..."
                  className="w-full h-11 px-4 rounded-2xl bg-slate-50 border border-slate-200 text-[14px] font-bold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:border-sky-400 focus:ring-2 focus:ring-sky-100/50 transition-all duration-200"
                />
              </div>

              {/* Confirm Password Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 ml-1">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  XÁC NHẬN MẬT KHẨU
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu..."
                  className="w-full h-11 px-4 rounded-2xl bg-slate-50 border border-slate-200 text-[14px] font-bold text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:border-sky-400 focus:ring-2 focus:ring-sky-100/50 transition-all duration-200"
                />
              </div>

              {/* Role Dropdown */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-extrabold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 ml-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  VAI TRÒ TRONG HỆ THỐNG
                </label>
                <div className="relative">
                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                    className="w-full h-11 pl-4 pr-10 rounded-2xl bg-slate-50 border border-slate-200 text-[14px] font-bold text-slate-800 appearance-none focus:outline-hidden focus:border-sky-400 focus:ring-2 focus:ring-sky-100/50 transition-all duration-200 cursor-pointer"
                  >
                    <option value="SYSTEM_ADMIN">Quản trị hệ thống (System Admin)</option>
                    <option value="SALES_ADMIN">Quản trị kinh doanh (Sales Admin)</option>
                    <option value="SALES_MANAGER">Giám đốc kinh doanh (Sales Manager)</option>
                  </select>
                  <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 mt-2 bg-[#006cb8] hover:bg-[#005ea2] active:scale-98 text-white rounded-2xl font-extrabold text-[15px] transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Đăng ký ngay"
                )}
              </button>
            </form>
          </div>

          {/* Footer - Switch to Login */}
          <div className="text-center pt-2 border-t border-slate-100">
            <span className="text-[13.5px] text-slate-500 font-medium">
              Đã có tài khoản?{' '}
              <Link to="/login" className="text-[#006cb8] hover:underline font-extrabold ml-1">
                Đăng nhập ngay
              </Link>
            </span>
          </div>

        </div>

      </div>
    </div>
  );
}
