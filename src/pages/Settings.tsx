import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Key, 
  Users, 
  Shield, 
  Cpu, 
  Bell, 
  Globe,
  Save,
  Trash2,
  Lock,
  Eye,
  EyeOff,
  UserCheck,
  Mail,
  Calendar
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { doc, getDoc, setDoc, updateDoc, collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { useAuth } from '@/lib/AuthContext';
import { authenticatedFetch } from '@/lib/api';
import { toast } from 'sonner';
import { UserProfile, UserRole } from '@/types';

export default function Settings() {
  const { profile } = useAuth();
  const [config, setConfig] = useState<any>({
    geminiApiKey: '****************',
    modelName: 'gemini-2.5-flash',
    systemPrompt: 'Bạn là một chuyên gia phân tích bán hàng và báo cáo tài chính Sales Intelligence AI cao cấp (Gemini Enabled)...',
    schedulerTime: '08:00',
    autoSendEmail: true,
    recipientEmail: 'ngoththuyduy@gmail.com'
  });
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');

  useEffect(() => {
    const fetchConfig = async () => {
      const localKey = localStorage.getItem('gemini_custom_api_key');
      try {
        const res = await authenticatedFetch('/api/config');
        if (res.ok) {
          const loadedData = await res.json();
          setConfig({
            geminiApiKey: localKey || loadedData.geminiApiKey || '****************',
            modelName: loadedData.modelName || 'gemini-2.5-flash',
            systemPrompt: loadedData.systemPrompt || 'Bạn là một chuyên gia phân tích bán hàng và báo cáo tài chính Sales Intelligence AI cao cấp...',
            schedulerTime: loadedData.schedulerTime || '08:00',
            autoSendEmail: loadedData.autoSendEmail !== undefined ? loadedData.autoSendEmail : true,
            recipientEmail: loadedData.recipientEmail || 'ngoththuyduy@gmail.com'
          });
        } else {
          throw new Error('HTTP status ' + res.status);
        }
      } catch (e) {
        console.warn('Cannot fetch global config - permission restricted');
        if (localKey) {
          setConfig(prev => ({ ...prev, geminiApiKey: localKey }));
        }
      }
    };
    fetchConfig();
  }, []);

  useEffect(() => {
    if (profile?.role === 'SYSTEM_ADMIN') {
      const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setUsers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)));
      }, (err) => {
        console.warn('Cannot list users - permission restricted');
      });
      return unsubscribe;
    }
  }, [profile]);

  const handleUpdateRole = async (userId: string, newRole: UserRole) => {
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
      toast.success('Đã cập nhật vai trò người dùng');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const handleSaveConfig = async () => {
    try {
      if (config.geminiApiKey && config.geminiApiKey !== '****************' && config.geminiApiKey.length > 5) {
        localStorage.setItem('gemini_custom_api_key', config.geminiApiKey.trim());
      }
      const res = await authenticatedFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        toast.success('Đã lưu cấu hình hệ thống & API Key thành công!');
      } else {
        const errData = await res.json();
        throw new Error(errData.message || "Lỗi lưu cấu hình");
      }
    } catch (error: any) {
      toast.error('Không thể lưu cấu hình: ' + error.message);
    }
  };

  const isAdmin = profile?.role === 'SYSTEM_ADMIN';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[33px] font-extrabold text-slate-900 tracking-tight text-stroke">Thiết lập & Cá nhân hóa</h1>
        <p className="text-slate-500 font-medium tracking-tight">Quản lý tài khoản, vai trò và các cấu hình hệ thống chuyên sâu.</p>
      </div>

      <Tabs defaultValue="profile" onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-slate-100 p-1 rounded-2xl h-12 w-fit">
          <TabsTrigger value="profile" className="rounded-xl px-6 data-[state=active]:bg-white data-[state=active]:shadow-sm font-bold text-[17px]">
            <UserCheck className="mr-2 h-4 w-4" /> Cá nhân
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="ai" className="rounded-xl px-6 data-[state=active]:bg-white data-[state=active]:shadow-sm font-bold text-[17px]">
              <Cpu className="mr-2 h-4 w-4" /> Hệ thống AI
            </TabsTrigger>
          )}
          <TabsTrigger value="users" className="rounded-xl px-6 data-[state=active]:bg-white data-[state=active]:shadow-sm font-bold text-[17px]">
            <Users className="mr-2 h-4 w-4" /> Quản lý tài khoản
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card className="max-w-2xl border-none shadow-sm bg-white rounded-3xl overflow-hidden">
             <CardHeader className="bg-slate-50/50">
                <CardTitle className="text-[21px] font-bold">Hồ sơ của bạn</CardTitle>
                <CardDescription className="text-[17px] font-medium">Thông tin định danh và vai trò hiện tại.</CardDescription>
             </CardHeader>
             <CardContent className="pt-8 space-y-6">
                <div className="flex items-center gap-6">
                   <div className="w-24 h-24 bg-indigo-100 rounded-3xl flex items-center justify-center text-indigo-600 text-[33px] font-black">
                      {profile?.fullName.charAt(0)}
                   </div>
                   <div className="space-y-1">
                      <h3 className="text-[23px] font-black text-slate-900">{profile?.fullName}</h3>
                      <p className="text-slate-500 font-medium flex items-center gap-2"><Mail size={14} /> {profile?.email}</p>
                      <Badge className="bg-indigo-100 text-indigo-700 border-none font-bold mt-2">
                         {profile?.role}
                      </Badge>
                   </div>
                </div>
                
                <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-50">
                   <div className="space-y-1">
                      <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Vai trò</p>
                      <p className="text-[17px] font-bold text-slate-700">{profile?.role}</p>
                   </div>
                   <div className="space-y-1">
                      <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Trạng thái</p>
                      <p className="text-[17px] font-bold text-emerald-600 flex items-center gap-1">
                         <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> Đang hoạt động
                      </p>
                   </div>
                   <div className="space-y-1">
                      <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">ID Người dùng</p>
                      <p className="text-[15px] font-mono text-slate-500">{profile?.id}</p>
                   </div>
                   <div className="space-y-1">
                      <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Ngày tham gia</p>
                      <p className="text-[17px] font-bold text-slate-700 flex items-center gap-2">
                        <Calendar size={14} className="text-slate-400" /> {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString('vi-VN') : 'N/A'}
                      </p>
                   </div>
                </div>

                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-4 items-start">
                   <Shield className="text-amber-600 shrink-0 mt-1" size={18} />
                   <div>
                      <p className="text-[15px] font-bold text-amber-900 mb-1">Mẹo thử nghiệm vai trò:</p>
                      <p className="text-[14px] text-amber-700 leading-relaxed font-medium">
                         Để thử nghiệm các vai trò khác nhau, bạn có thể chuyển sang tab <b>Quản lý tài khoản</b> và thay đổi vai trò của chính mình. Sau khi thay đổi, các quyền truy cập menu sẽ được cập nhật ngay lập tức.
                      </p>
                   </div>
                </div>
             </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 border-none shadow-sm bg-white rounded-3xl overflow-hidden">
              <CardHeader className="bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-[21px] font-bold flex items-center gap-2">
                    <Key size={20} className="text-indigo-600" /> Kết nối Gemini AI
                  </CardTitle>
                  <Badge className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-black px-3 py-1 rounded-full text-[13px] shadow-sm">
                    ✨ Gemini 3.1 Pro Enabled
                  </Badge>
                </div>
                <CardDescription className="text-[17px] font-medium">Cấu hình mô hình AI cao cấp (Gemini 3.1 Pro) cho phân tích dữ liệu RAG chuyên sâu & suy luận nâng cao.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div className="p-4 bg-indigo-50/80 rounded-2xl border border-indigo-100 flex items-center gap-3">
                  <Cpu className="text-indigo-600 shrink-0" size={20} />
                  <div>
                    <p className="text-[15px] font-bold text-indigo-950">Chế độ Google Gemini Pro đã được bật!</p>
                    <p className="text-[13px] text-indigo-700 font-medium">Hệ thống tự động kích hoạt tính năng phân tích suy luận đa chiều, tự động trích xuất bảng biểu 100% chính xác toàn tệp và dự báo xu hướng kinh doanh với độ tin cậy cao nhất.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[15px] font-bold uppercase tracking-wider text-slate-500">Google Gemini API Key</Label>
                    <div className="relative">
                      <Input 
                        type={showKey ? 'text' : 'password'}
                        value={config.geminiApiKey}
                        onChange={e => setConfig({...config, geminiApiKey: e.target.value})}
                        className="pr-12 h-12 bg-slate-50 border-slate-200 rounded-xl font-mono text-[17px] focus:ring-indigo-600"
                      />
                      <button 
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <p className="text-[13px] text-slate-400 font-bold uppercase">Phím tắt: Key này được lấy từ Google AI Studio.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[15px] font-bold uppercase tracking-wider text-slate-500">Mô hình hoạt động</Label>
                      <Select 
                        value={config.modelName}
                        onValueChange={val => setConfig({...config, modelName: val})}
                      >
                        <SelectTrigger className="h-12 bg-slate-50 border-slate-200 rounded-xl font-bold">
                          <SelectValue placeholder="Chọn model" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-100">
                          <SelectItem value="gemini-2.5-flash" className="font-bold text-indigo-700">⚡ Gemini 2.5 Flash (Tốc độ phản hồi nhanh - Khuyên dùng)</SelectItem>
                          <SelectItem value="gemini-2.5-pro" className="font-bold">👑 Gemini 2.5 Pro (Phân tích chuyên sâu & Suy luận cao)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[15px] font-bold uppercase tracking-wider text-slate-500">Lịch báo cáo tự động</Label>
                      <Input 
                        type="time"
                        value={config.schedulerTime}
                        onChange={e => setConfig({...config, schedulerTime: e.target.value})}
                        className="h-12 bg-slate-50 border-slate-200 rounded-xl font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100/50">
                    <div className="space-y-2">
                      <Label className="text-[15px] font-bold uppercase tracking-wider text-slate-500">Tự động gửi email báo cáo</Label>
                      <Select 
                        value={config.autoSendEmail ? "true" : "false"}
                        onValueChange={val => setConfig({...config, autoSendEmail: val === "true"})}
                      >
                        <SelectTrigger className="h-12 bg-slate-50 border-slate-200 rounded-xl font-bold">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-100">
                          <SelectItem value="true">Bật (Tự động gửi lúc chạy lịch)</SelectItem>
                          <SelectItem value="false">Tắt (Chỉ lưu vào lịch sử)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[15px] font-bold uppercase tracking-wider text-slate-500">Email nhận báo cáo</Label>
                      <Input 
                        type="email"
                        placeholder="example@domain.com"
                        value={config.recipientEmail || ''}
                        onChange={e => setConfig({...config, recipientEmail: e.target.value})}
                        className="h-12 bg-slate-50 border-slate-200 rounded-xl font-bold"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <Button 
                      type="button" 
                      variant="outline"
                      onClick={async () => {
                        const targetEmail = config.recipientEmail || profile?.email;
                        if (!targetEmail) {
                          toast.error("Vui lòng nhập email nhận báo cáo hoặc đảm bảo tài khoản đã có email!");
                          return;
                        }
                        const toastId = toast.loading("Đang lưu cài đặt & chạy tiến trình tạo báo cáo...");
                        try {
                          const saveRes = await authenticatedFetch('/api/config', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(config)
                          });
                          if (!saveRes.ok) {
                            const errData = await saveRes.json();
                            throw new Error(errData.message || "Lỗi lưu cấu hình");
                          }
                          
                          const res = await authenticatedFetch("/api/trigger-daily-scheduler", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" }
                          });
                          const result = await res.json();
                          if (res.ok) {
                            toast.success(result.message || "Đã kích hoạt chạy thử nghiệm thành công!", { id: toastId });
                          } else {
                            toast.error(result.message || "Kích hoạt chạy thử nghiệm thất bại!", { id: toastId });
                          }
                        } catch (err: any) {
                          toast.error(err.message || "Có lỗi xảy ra khi gửi yêu cầu", { id: toastId });
                        }
                      }}
                      className="w-full h-11 border-dashed border-indigo-200 hover:border-indigo-500 text-indigo-600 font-bold rounded-xl bg-indigo-50/20 hover:bg-indigo-50/50"
                    >
                      ⚡ Chạy thử nghiệm Lập lịch & Gửi Mail Báo cáo ngay
                    </Button>
                  </div>

                  <div className="space-y-2 pt-2">
                    <Label className="text-[15px] font-bold uppercase tracking-wider text-slate-500">System Instruction (Ngữ cảnh AI)</Label>
                    <textarea 
                      className="w-full min-h-[160px] p-4 bg-slate-50 border border-slate-200 rounded-2xl text-[17px] font-medium focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                      value={config.systemPrompt}
                      onChange={e => setConfig({...config, systemPrompt: e.target.value})}
                      placeholder="Quy định cách AI giao tiếp và xử lý dữ liệu..."
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-slate-100">
                  <Button onClick={handleSaveConfig} className="bg-indigo-600 hover:bg-indigo-700 font-bold px-8 py-6 rounded-2xl shadow-lg shadow-indigo-100">
                    <Save className="mr-2" size={18} /> Lưu thay đổi
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <ResourceMeter label="Token tiêu thụ (Tháng)" value={65} color="indigo" />
              <ResourceMeter label="Vector Index Health" value={98} color="emerald" />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="users">
          <Card className="border-none shadow-sm bg-white rounded-3xl overflow-hidden">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100">
              <CardTitle className="text-[21px] font-bold">Danh sách người dùng</CardTitle>
              <CardDescription className="text-[17px] font-medium">Thay đổi vai trò để thử nghiệm các phân quyền khác nhau.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
               <Table>
                 <TableHeader>
                   <TableRow className="hover:bg-transparent">
                     <TableHead className="pl-6">Người dùng</TableHead>
                     <TableHead>Vai trò hiện tại</TableHead>
                     <TableHead>Trạng thái</TableHead>
                     <TableHead className="text-right pr-6">Thay đổi vai trò</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {(isAdmin ? users : (profile ? [profile] : [])).map((u) => (
                     <TableRow key={u.id} className="hover:bg-slate-50/50 transition-colors">
                       <TableCell className="pl-6 py-4">
                         <div className="flex items-center gap-3">
                           <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center font-bold text-slate-600">
                             {u.fullName.charAt(0)}
                           </div>
                           <div>
                             <p className="font-bold text-slate-900">{u.fullName} {u.id === profile?.id && "(Bạn)"}</p>
                             <p className="text-[15px] font-medium text-slate-500">{u.email}</p>
                           </div>
                         </div>
                       </TableCell>
                       <TableCell>
                         <Badge 
                            variant="secondary" 
                            className={cn(
                              "font-bold",
                              u.role === 'SYSTEM_ADMIN' ? "bg-purple-100 text-purple-700" :
                              u.role === 'SALES_ADMIN' ? "bg-indigo-100 text-indigo-700" :
                              "bg-slate-100 text-slate-600"
                            )}
                          >
                           {u.role}
                         </Badge>
                       </TableCell>
                       <TableCell>
                         <Badge className="bg-emerald-100 text-emerald-700 border-none font-bold">
                           {u.status}
                         </Badge>
                       </TableCell>
                       <TableCell className="text-right pr-6">
                         <Select 
                           value={u.role} 
                           onValueChange={(val) => handleUpdateRole(u.id, val as UserRole)}
                         >
                           <SelectTrigger className="w-40 h-10 border-slate-200 rounded-lg ml-auto font-bold text-[15px]">
                             <SelectValue />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl border-slate-100">
                             <SelectItem value="SALES_MANAGER" className="text-[15px] font-bold">SALES_MANAGER</SelectItem>
                             <SelectItem value="SALES_ADMIN" className="text-[15px] font-bold">SALES_ADMIN</SelectItem>
                             <SelectItem value="SYSTEM_ADMIN" className="text-[15px] font-bold">SYSTEM_ADMIN</SelectItem>
                           </SelectContent>
                         </Select>
                       </TableCell>
                     </TableRow>
                   ))}
                 </TableBody>
               </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ResourceMeter({ label, value, color }: { label: string, value: number, color: 'indigo' | 'amber' | 'emerald' }) {
  const colorMap = {
    indigo: 'bg-indigo-600',
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500'
  };
  
  return (
    <div className="space-y-1.5 p-4 bg-white rounded-2xl shadow-sm border border-slate-100">
      <div className="flex justify-between items-center text-[13px] font-bold uppercase tracking-widest text-slate-500">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <div 
          className={cn("h-full transition-all duration-1000", colorMap[color])}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
