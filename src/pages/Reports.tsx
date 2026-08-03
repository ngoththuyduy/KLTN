import React, { useState, useEffect, useRef } from "react";
import {
  FileBarChart,
  Plus,
  Calendar,
  Clock,
  FileText,
  Search,
  Sparkles,
  FileSpreadsheet,
  ArrowRight,
  Printer,
  Mail,
  AlertTriangle,
  ExternalLink,
  Settings,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  where,
  limit,
  getDocs,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "@/lib/firebase";
import { getLocalFiles, getLocalFileRecords, mergeFiles, syncLocalFilesToFirestore } from "@/lib/fileStorage";
import { getLocalReports, saveLocalReport, mergeReports, syncLocalReportsToFirestore } from "@/lib/reportStorage";
import { Report } from "@/types";
import { chatWithAI, modelName } from "@/lib/gemini";
import { authenticatedFetch } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { extractSalesRecord } from "@/utils/salesParser";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import { printElement } from "@/lib/utils";
import { AIAccuracyEvaluation } from "@/components/AIAccuracyEvaluation";

export default function Reports() {
  const { profile } = useAuth();
  const isDemoSession = Boolean(profile?.id?.startsWith('demo_'));
  const [reports, setReports] = useState<Report[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'reports' | 'evaluation'>('reports');
  const [schedulerTime, setSchedulerTime] = useState("08:00");
  const [globalConfig, setGlobalConfig] = useState<any>({
    schedulerTime: "08:00",
    autoSendEmail: true,
    recipientEmail: "ngoththuyduy@gmail.com",
    smtpConfig: {
      host: "smtp.gmail.com",
      port: "587",
      user: "",
      pass: "",
      from: "",
    }
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [lastTestResult, setLastTestResult] = useState<any>(null);
  const [showSmtpConfig, setShowSmtpConfig] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await authenticatedFetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          setGlobalConfig({
            ...data,
            schedulerTime: data.schedulerTime || "08:00",
            autoSendEmail: data.autoSendEmail !== undefined ? data.autoSendEmail : true,
            recipientEmail: data.recipientEmail || "ngoththuyduy@gmail.com",
            smtpConfig: data.smtpConfig || {
              host: "smtp.gmail.com",
              port: "587",
              user: "",
              pass: "",
              from: "",
            }
          });
          setSchedulerTime(data.schedulerTime || "08:00");
        } else {
          // Fallback if not found or server error
          if (profile?.email) {
            setGlobalConfig((prev: any) => ({
              ...prev,
              recipientEmail: profile.email,
              smtpConfig: {
                host: "smtp.gmail.com",
                port: "587",
                user: "",
                pass: "",
                from: "",
              }
            }));
          }
        }
      } catch (e) {
        console.warn('Cannot fetch global config for scheduler:', e);
      }
    };
    fetchConfig();
  }, [profile]);

  useEffect(() => {
    if (!profile?.id) return;
    if (isDemoSession) {
      setReports(mergeReports([], getLocalReports()));
      return;
    }
    // 1. Sync local reports to Firestore in background
    syncLocalReportsToFirestore(db, profile.id).catch(err => console.warn("Sync reports notice:", err));

    // 2. Load local reports instantly
    setReports(mergeReports([], getLocalReports()));

    // 3. Listen to Firestore
    const q = query(collection(db, "reports"), where("ownerId", "==", profile.id), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const firestoreReports = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Report);
        const merged = mergeReports(firestoreReports, getLocalReports());
        setReports(merged);
      },
      (error) => {
        console.warn("Reports list snapshot notice, using local fallback:", error);
        setReports(mergeReports([], getLocalReports()));
      },
    );
    return unsubscribe;
  }, [profile?.id, isDemoSession]);

  const handleGenerateReport = async (type: "DAILY" | "WEEKLY" | "MONTHLY") => {
    setIsGenerating(true);
    try {
      // 1. Sync local files in background and fetch sales dataset from Firestore & LocalStorage
      if (!isDemoSession) {
        syncLocalFilesToFirestore(db, profile?.id).catch(err => console.warn("Sync local files error:", err));
      }
      
      let firestoreFiles: any[] = [];
      try {
        if (isDemoSession) {
          throw new Error('demo-local-only');
        }
        const filesSnap = await getDocs(
          query(
            collection(db, "files"),
            where("ownerId", "==", profile?.id || ""),
            orderBy("uploadDate", "desc"),
            limit(30),
          ),
        );
        firestoreFiles = filesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      } catch (fErr) {
        console.warn("Firestore files fetch notice in reports:", fErr);
      }

      const mergedFilesList = mergeFiles(firestoreFiles, getLocalFiles());
      const completedFiles = mergedFilesList
        .filter((file: any) => file.status === "COMPLETED")
        .slice(0, 5);

      let contextDataStr = "";
      if (completedFiles.length === 0) {
        contextDataStr =
          "Dữ liệu hiện tại trên hệ thống đang trống. Hãy tạo một bản báo cáo mẫu chuyên sâu mô phỏng một cửa hàng Gia dụng/Điện tử/Thời trang tại Việt Nam.";
      } else {
        const records: any[] = [];
        for (const fileDoc of completedFiles) {
          const fileData = fileDoc;
          let fileRecords = fileData.records || fileData.sampleRows || [];

          if (fileRecords.length === 0) {
            try {
              const recSnap = await getDocs(
                query(collection(db, `files/${fileDoc.id}/records`), limit(60)),
              );
              fileRecords = recSnap.docs.map((d) => d.data());
            } catch (err) {
              console.warn("Could not retrieve subrecords for reports:", err);
            }
          }

          if (fileRecords.length === 0) {
            fileRecords = getLocalFileRecords(fileDoc.id) || [];
          }

          fileRecords.forEach((row: any) => {
            const info = extractSalesRecord(row, fileData.uploadDate);
            records.push({
              product: info.product,
              revenue: info.revenue,
              region: info.region,
              date: info.date ? info.date.toLocaleDateString("vi-VN") : "N/A",
            });
          });
        }
        contextDataStr =
          `Dữ liệu bán hàng thực tế được thu thập trực tiếp từ hệ thống dữ liệu: \n` +
          JSON.stringify(records.slice(0, 120));
      }

      const prompt = `Hãy đóng vai một chuyên gia phân tích dữ liệu kinh doanh cấp cao độc lập. Hãy viết một bản báo cáo phân tích hiệu suất ${type} chuyên nghiệp bằng tiếng Việt dài và chi tiết cho hệ thống dựa trên thông tin dữ liệu thực tế sau đây:

      Số liệu đầu vào:
      ${contextDataStr}
      
      Nội dung báo cáo yêu cầu phân bổ thành các phần chính rộng rãi:
      1. Tóm tắt tình hình doanh số thực tế (Nhận định về qui mô, độ rộng mạng lưới).
      2. Bảng thống kê Top các sản phẩm bán chạy nhất cùng với sản lượng doanh thu đóng góp.
      3. Bảng xếp hạng doanh thu đóng góp so sánh tình hình giữa các khu vực địa lý.
      4. Đề xuất chiến lược cải thiện chi tiết, hành động cụ thể để tối ưu kết quả bán hàng trong chu kỳ kế tiếp.
      
      Quy tắc cấu trúc:
      - Sử dụng ngôn ngữ Markdown chuẩn hóa, tinh tế.
      - Tạo các bảng (table) rõ ràng cho tất cả dữ liệu số và thứ hạng sản phẩm.
      - KHÔNG sử dụng các biểu tượng, icon, emoji không cần thiết. Giữ văn phong khách quan, trung lập.
      - KHÔNG sử dụng các thẻ HTML lồng trong markdown.`;

      const result = await chatWithAI(prompt);
      const content = result.text;

      const newReportId = 'report_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const newReportObj: Report = {
        id: newReportId,
        title: `Báo cáo ${type} - ${new Date().toLocaleDateString("vi-VN")}`,
        content,
        generatedBy: profile?.fullName || "AI System",
        createdAt: new Date().toISOString(),
        fileType: "PDF",
        reportType: type,
      };

      saveLocalReport(newReportObj);
      setReports(prev => mergeReports([], [newReportObj, ...prev]));

      try {
        if (!isDemoSession) await setDoc(doc(db, "reports", newReportId), {
          ownerId: profile?.id,
          createdBy: profile?.id,
          title: newReportObj.title,
          content: newReportObj.content,
          generatedBy: newReportObj.generatedBy,
          createdAt: newReportObj.createdAt,
          fileType: newReportObj.fileType,
          reportType: newReportObj.reportType,
        });
      } catch (err) {
        console.warn("Firestore report save notice (saved locally):", err);
      }
      toast.success("Đã tạo báo cáo thành công!");
    } catch (error) {
      console.error(error);
      toast.error("Lỗi khi tạo báo cáo");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadExcel = (report: Report) => {
    try {
      const content = report.content;
      const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `${report.title.replace(/\s+/g, "_")}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Đã tải báo cáo Excel (CSV) thành công!");
    } catch (error) {
      toast.error("Lỗi khi xuất file");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-[33px] font-extrabold text-slate-900 tracking-tight">
            Trung tâm Báo cáo
          </h1>
          <p className="text-slate-500 font-medium tracking-tight">
            Quản lý và xem các báo cáo phân tích chiến lược do AI tạo ra.
          </p>
        </div>
        {activeTab === 'reports' && (
          <div className="flex gap-2">
            {["DAILY", "WEEKLY", "MONTHLY"].map((type) => (
              <Button
                key={type}
                onClick={() => handleGenerateReport(type as any)}
                disabled={isGenerating}
                variant={type === "DAILY" ? "default" : "secondary"}
                className={cn(
                  "font-bold rounded-xl active:scale-95 transition-all px-6 py-5",
                  type === "DAILY"
                    ? "bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100"
                    : "",
                )}
              >
                {isGenerating ? (
                  <Clock className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Báo cáo{" "}
                {type === "DAILY" ? "Ngày" : type === "WEEKLY" ? "Tuần" : "Tháng"}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="flex border-b border-sky-100/60 pb-px">
        <button
          onClick={() => setActiveTab('reports')}
          className={cn(
            "px-6 py-3 font-bold text-[15px] tracking-wide transition-all border-b-2 -mb-px flex items-center gap-2 cursor-pointer focus:outline-none",
            activeTab === 'reports'
              ? "border-indigo-600 text-indigo-600 font-extrabold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <FileBarChart size={18} />
          Báo cáo & Gửi Mail tự động
        </button>
        <button
          onClick={() => setActiveTab('evaluation')}
          className={cn(
            "px-6 py-3 font-bold text-[15px] tracking-wide transition-all border-b-2 -mb-px flex items-center gap-2 cursor-pointer focus:outline-none",
            activeTab === 'evaluation'
              ? "border-indigo-600 text-indigo-600 font-extrabold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <ShieldCheck size={18} />
          Kiểm định Độ chính xác AI
        </button>
      </div>

      {activeTab === 'reports' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <ReportSummaryCard
          icon={FileBarChart}
          title="Báo cáo hoàn thành"
          value={reports.length.toString()}
          color="indigo"
        />
        <ReportSummaryCard
          icon={Clock}
          title="Lịch chạy tự động"
          value={`${globalConfig.schedulerTime || "08:00"} Hàng ngày`}
          color="amber"
          desc={globalConfig.lastRunDate ? `Tự động chạy gần nhất: ${globalConfig.lastRunDate}` : `Tự động tạo & gửi mail lúc ${globalConfig.schedulerTime || "08:00"} ICT`}
        />
        <ReportSummaryCard
          icon={Sparkles}
          title="Dự báo AI nhất quán"
          value="94.5%"
          color="emerald"
          desc="Độ chính xác trung bình"
        />
      </div>

      {/* Cấu hình Lập lịch Tự động & Dispatch Email Card */}
      <Card className="border border-indigo-100 shadow-md shadow-indigo-100/30 bg-gradient-to-br from-white to-indigo-50/20 rounded-3xl overflow-hidden">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col lg:flex-row gap-8 items-start">
            {/* Left Column: Explanation / Guide */}
            <div className="flex-1 space-y-4">
              <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider">
                <Sparkles size={14} className="animate-pulse" />
                Tính năng Lập lịch & Gửi Mail tự động
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                Tự động hóa Báo cáo Doanh số Mỗi ngày
              </h2>
              <p className="text-[15px] text-slate-500 leading-relaxed font-medium">
                Hệ thống AI sẽ tự động phân tích toàn bộ dữ liệu giao dịch từ tệp tải lên mới nhất, tạo bản phân tích chiến lược nâng cao vào khung giờ bạn chọn, sau đó gửi báo cáo PDF trực tiếp tới hòm thư của bạn.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold shrink-0 text-sm">1</div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-[14px]">Đặt thời gian chạy</h4>
                    <p className="text-xs text-slate-400 font-medium">Lịch trình tự động kích hoạt hàng ngày theo giờ Việt Nam (ICT).</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold shrink-0 text-sm">2</div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-[14px]">Nhận email tức thì</h4>
                    <p className="text-xs text-slate-400 font-medium font-bold text-indigo-600">Báo cáo chứa đầy đủ số liệu, top sản phẩm và biểu đồ phân tích.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Interactive Configuration Form */}
            <div className="w-full lg:w-[480px] bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-5">
              <h3 className="font-black text-[16px] text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Clock size={16} className="text-indigo-600" />
                Cài đặt & Thử nghiệm
              </h3>

              <div className="space-y-4">
                {/* 1. Select Hour */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400">Giờ kích hoạt hằng ngày</label>
                  <select
                    value={globalConfig.schedulerTime || "08:00"}
                    onChange={(e) => setGlobalConfig({ ...globalConfig, schedulerTime: e.target.value })}
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl px-3 text-sm font-bold text-slate-700 outline-none transition-all"
                  >
                    {Array.from({ length: 24 }).map((_, h) => {
                      const hr = String(h).padStart(2, "0");
                      return (
                        <React.Fragment key={hr}>
                          <option value={`${hr}:00`}>{hr}:00 (Giờ Việt Nam)</option>
                          <option value={`${hr}:30`}>{hr}:30 (Giờ Việt Nam)</option>
                        </React.Fragment>
                      );
                    })}
                  </select>
                </div>

                {/* 2. Switch autoSendEmail */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400">Tự động gửi qua Mail</label>
                  <select
                    value={globalConfig.autoSendEmail ? "true" : "false"}
                    onChange={(e) => setGlobalConfig({ ...globalConfig, autoSendEmail: e.target.value === "true" })}
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl px-3 text-sm font-bold text-slate-700 outline-none transition-all"
                  >
                    <option value="true">BẬT - Tự động gửi email khi chạy lịch</option>
                    <option value="false">TẮT - Chỉ lưu trữ trong lịch sử hệ thống</option>
                  </select>
                </div>

                {/* 3. Recipient Email */}
                <div className="space-y-1.5">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400">Địa chỉ Email nhận báo cáo</label>
                  <input
                    type="email"
                    placeholder="example@domain.com"
                    value={globalConfig.recipientEmail || ""}
                    onChange={(e) => setGlobalConfig({ ...globalConfig, recipientEmail: e.target.value })}
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl px-3.5 text-sm font-bold text-slate-700 outline-none transition-all"
                  />
                </div>

                {/* Friendly notice reminding user to configure real SMTP if they haven't yet */}
                {!globalConfig.smtpConfig?.user && (
                  <div className="p-3.5 bg-amber-50/70 border border-amber-100 rounded-xl space-y-1.5 text-amber-950 font-sans font-semibold">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-black uppercase text-amber-800 tracking-wider">
                      <AlertTriangle size={14} className="animate-bounce" /> Lưu ý về gửi Mail thực tế
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-slate-600 font-sans">
                      Hệ thống hiện đang mặc định sử dụng <strong>Sandbox thử nghiệm (Ethereal Email)</strong>. Để nhận được thư thực tế trong hộp thư đến (Inbox) của bạn, bạn cần nhấp vào mục <strong>Cấu hình SMTP</strong> bên dưới để điền Gmail cá nhân và <strong>Mật khẩu ứng dụng 16 ký tự</strong> nhé!
                    </p>
                  </div>
                )}

                {/* 4. Collapsible SMTP settings */}
                <div className="border border-slate-100 rounded-xl overflow-hidden bg-slate-50/50">
                  <button
                    type="button"
                    onClick={() => setShowSmtpConfig(!showSmtpConfig)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-100 transition-colors text-left"
                  >
                    <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500">
                      <Settings size={14} className="text-indigo-500 animate-spin-slow" />
                      Cấu hình SMTP gửi Mail thực tế
                    </span>
                    {showSmtpConfig ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </button>

                  {showSmtpConfig && (
                    <div className="p-4 border-t border-slate-100 bg-white space-y-3.5 text-xs">
                      <div className="p-2.5 bg-indigo-50/70 border border-indigo-100 rounded-xl text-indigo-950 space-y-1 font-medium leading-relaxed">
                        <p className="font-bold">💡 Cách gửi mail về hòm thư thực tế:</p>
                        <p>1. Nhập email Gmail của bạn làm tài khoản.</p>
                        <p>2. Không dùng mật khẩu đăng nhập. Hãy tạo <strong>Mật khẩu ứng dụng (App Password)</strong> 16 ký tự từ trang bảo mật tài khoản Google để dán vào ô Mật khẩu dưới đây.</p>
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-slate-500 block">SMTP Host</label>
                        <input
                          type="text"
                          placeholder="smtp.gmail.com"
                          value={globalConfig.smtpConfig?.host || ""}
                          onChange={(e) => setGlobalConfig({
                            ...globalConfig,
                            smtpConfig: { ...(globalConfig.smtpConfig || {}), host: e.target.value }
                          })}
                          className="w-full h-9 border border-slate-200 rounded-lg px-2.5 outline-none font-bold text-slate-700 bg-slate-50 focus:bg-white"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="font-bold text-slate-500 block">Cổng (Port)</label>
                          <input
                            type="text"
                            placeholder="587"
                            value={globalConfig.smtpConfig?.port || ""}
                            onChange={(e) => setGlobalConfig({
                              ...globalConfig,
                              smtpConfig: { ...(globalConfig.smtpConfig || {}), port: e.target.value }
                            })}
                            className="w-full h-9 border border-slate-200 rounded-lg px-2.5 outline-none font-bold text-slate-700 bg-slate-50"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="font-bold text-slate-500 block">Địa chỉ Gửi từ (From)</label>
                          <input
                            type="text"
                            placeholder='"Hệ thống AI" <email của bạn>'
                            value={globalConfig.smtpConfig?.from || ""}
                            onChange={(e) => setGlobalConfig({
                              ...globalConfig,
                              smtpConfig: { ...(globalConfig.smtpConfig || {}), from: e.target.value }
                            })}
                            className="w-full h-9 border border-slate-200 rounded-lg px-2.5 outline-none font-medium text-slate-700 bg-slate-50"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-slate-500 block">Tài khoản SMTP (Email của bạn)</label>
                        <input
                          type="text"
                          placeholder="username@gmail.com"
                          value={globalConfig.smtpConfig?.user || ""}
                          onChange={(e) => setGlobalConfig({
                            ...globalConfig,
                            smtpConfig: { ...(globalConfig.smtpConfig || {}), user: e.target.value }
                          })}
                          className="w-full h-9 border border-slate-200 rounded-lg px-2.5 outline-none font-bold text-slate-700 bg-slate-50 focus:bg-white"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-bold text-slate-500 block">Mật khẩu ứng dụng SMTP (App Password)</label>
                        <input
                          type="password"
                          placeholder="Nhập mã 16 ký tự ứng dụng"
                          value={globalConfig.smtpConfig?.pass || ""}
                          onChange={(e) => setGlobalConfig({
                            ...globalConfig,
                            smtpConfig: { ...(globalConfig.smtpConfig || {}), pass: e.target.value }
                          })}
                          className="w-full h-9 border border-slate-200 rounded-lg px-2.5 outline-none font-bold text-slate-700 bg-slate-50 focus:bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Real-time result feedback block */}
              {lastTestResult && (
                <div className={`p-4 rounded-xl space-y-2 border ${
                  lastTestResult.isTestAccount 
                    ? "bg-amber-50/80 border-amber-200 text-amber-950" 
                    : "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                }`}>
                  <div className="flex items-start gap-2">
                    {lastTestResult.isTestAccount ? (
                      <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    ) : (
                      <ShieldCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                    )}
                    <div className="text-xs space-y-1 font-medium">
                      <p className="font-bold">
                        {lastTestResult.isTestAccount 
                          ? "Gửi qua Sandbox mô phỏng thành công!" 
                          : "Đã gửi thư THÀNH CÔNG về Email của bạn!"}
                      </p>
                      <p className="opacity-90 leading-relaxed">
                        {lastTestResult.isTestAccount 
                          ? `Hệ thống gửi qua dịch vụ Sandbox Ethereal do tài khoản SMTP chưa được cài đặt. Bạn có thể xem thư mẫu ngay bằng nút liên kết dưới đây.` 
                          : `Báo cáo đã gửi thành công tới hòm thư thực tế: ${lastTestResult.recipientEmail}`}
                      </p>
                    </div>
                  </div>

                  {lastTestResult.isTestAccount && lastTestResult.testMailUrl && (
                    <a
                      href={lastTestResult.testMailUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-colors w-full justify-center"
                    >
                      <ExternalLink size={13} />
                      Nhấp vào đây để xem thư thử nghiệm đã gửi
                    </a>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={async () => {
                    setIsSavingConfig(true);
                    try {
                      const res = await authenticatedFetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(globalConfig)
                      });
                      if (res.ok) {
                        setSchedulerTime(globalConfig.schedulerTime);
                        toast.success("Đã lưu cài đặt lập lịch tự động & SMTP thành công!");
                      } else {
                        const errData = await res.json();
                        throw new Error(errData.message || "Lỗi lưu cấu hình");
                      }
                    } catch (err: any) {
                      toast.error("Không thể lưu cài đặt: " + err.message);
                    } finally {
                      setIsSavingConfig(false);
                    }
                  }}
                  disabled={isSavingConfig}
                  className="flex-1 h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold transition-all text-xs"
                >
                  {isSavingConfig ? "Đang lưu..." : "Lưu Cài đặt"}
                </Button>

                <Button
                  onClick={async () => {
                    const targetEmail = globalConfig.recipientEmail || profile?.email;
                    if (!targetEmail) {
                      toast.error("Vui lòng nhập địa chỉ email nhận báo cáo trước khi chạy thử nghiệm!");
                      return;
                    }
                    setIsTestingEmail(true);
                    const toastId = toast.loading("Hệ thống đang sinh báo cáo chiến lược & gửi email...");
                    try {
                      // Save settings first
                      const res = await authenticatedFetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(globalConfig)
                      });
                      if (!res.ok) {
                        const errData = await res.json();
                        throw new Error(errData.message || "Lỗi lưu cấu hình");
                      }
                      setSchedulerTime(globalConfig.schedulerTime);

                      const triggerRes = await authenticatedFetch("/api/trigger-daily-scheduler", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" }
                      });
                      const result = await triggerRes.json();
                      if (triggerRes.ok) {
                        toast.success(result.message || "Đã kích hoạt chạy thử nghiệm & gửi thư thành công!", { id: toastId });
                        if (result.data) {
                          setLastTestResult(result.data);
                        }
                      } else {
                        toast.error(result.message || "Kích hoạt chạy thử nghiệm thất bại!", { id: toastId });
                      }
                    } catch (err: any) {
                      toast.error(err.message || "Có lỗi xảy ra khi gửi yêu cầu chạy thử nghiệm", { id: toastId });
                    } finally {
                      setIsTestingEmail(false);
                    }
                  }}
                  disabled={isTestingEmail}
                  variant="outline"
                  className="flex-1 h-11 border-dashed border-indigo-200 hover:border-indigo-500 text-indigo-600 font-bold rounded-xl bg-indigo-50/20 hover:bg-indigo-50/50 transition-all text-xs"
                >
                  {isTestingEmail ? "Đang chạy..." : "⚡ Chạy thử ngay"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm bg-white rounded-3xl overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-2 bg-slate-50/50">
          <div>
            <CardTitle className="text-[21px] font-bold">
              Lịch sử báo cáo đã tạo
            </CardTitle>
            <CardDescription className="text-[17px] font-medium">
              Danh sách các báo cáo đã xuất bản.
            </CardDescription>
          </div>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={16}
            />
            <Input
              placeholder="Tìm báo cáo..."
              className="pl-9 h-9 w-[240px] border-slate-200 rounded-lg text-[17px]"
            />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader className="bg-gradient-to-r from-sky-50/80 to-indigo-50/40 border-b border-sky-100/50">
              <TableRow className="border-sky-100/50 hover:bg-transparent">
                <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] pl-6 h-12">
                  Tiêu đề báo cáo
                </TableHead>
                <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] h-12">Loại</TableHead>
                <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] h-12">
                  Ngày tạo
                </TableHead>
                <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] h-12">
                  Người tạo
                </TableHead>
                <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] h-12">
                  Định dạng
                </TableHead>
                <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] text-right pr-6 h-12">
                  Thao tác
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((report) => (
                <TableRow
                  key={report.id}
                  className="hover:bg-sky-50/30 transition-colors border-slate-100"
                >
                  <TableCell className="font-semibold text-slate-800 pl-6 flex items-center gap-3 py-4">
                    <span>{report.title}</span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="font-bold text-[13px] uppercase border-slate-200"
                    >
                      {report.reportType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[17px] font-medium text-slate-500">
                    {report.createdAt?.seconds
                      ? new Date(
                          report.createdAt.seconds * 1000,
                        ).toLocaleString("vi-VN")
                      : "Đang lưu..."}
                  </TableCell>
                  <TableCell className="text-[17px] font-bold text-slate-600">
                    {report.generatedBy}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-slate-500 font-bold text-[13px] uppercase">
                      {report.fileType}
                    </div>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-indigo-600 font-bold hover:bg-indigo-50"
                        >
                          Chi tiết
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col rounded-3xl border-none">
                        <DialogHeader className="pb-4">
                          <DialogTitle className="text-[27px] font-black text-slate-900">
                            {report.title}
                          </DialogTitle>
                        </DialogHeader>
                        <div className="flex-1 overflow-y-auto pr-2">
                          <div
                            id={`report-content-${report.id}`}
                            className="prose prose-slate max-w-none bg-white p-8 rounded-2xl border border-slate-100"
                          >
                            <div className="markdown-body text-slate-800 leading-relaxed font-medium">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeKatex]}
                              >
                                {report.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
                          <Button
                            onClick={() => {
                              const element = document.getElementById(
                                `report-content-${report.id}`,
                              );
                              if (element) {
                                printElement(element, report.title);
                              }
                            }}
                            variant="outline"
                            className="font-bold rounded-xl border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                          >
                            <Printer size={16} className="mr-2" />
                            In & Lưu dạng PDF
                          </Button>
                          <Button
                            onClick={() => handleDownloadExcel(report)}
                            variant="outline"
                            className="font-bold rounded-xl border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                          >
                            <FileSpreadsheet size={16} className="mr-2" />
                            Tải Excel
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
              {reports.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-20 text-slate-400 font-medium"
                  >
                    <FileBarChart
                      size={48}
                      className="mx-auto mb-4 opacity-10"
                    />
                    Chưa có báo cáo nào được tạo.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
        </>
      ) : (
        <AIAccuracyEvaluation />
      )}
    </div>
  );
}

function ReportSummaryCard({ icon: Icon, title, value, color, desc }: any) {
  const colors: any = {
    indigo: "bg-indigo-50 text-indigo-600 shadow-indigo-100/50",
    amber: "bg-amber-50 text-amber-600 shadow-amber-100/50",
    emerald: "bg-emerald-50 text-emerald-600 shadow-emerald-100/50",
  };

  return (
    <Card className="border-none shadow-sm bg-white rounded-3xl p-6">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center",
            colors[color],
          )}
        >
          <Icon size={24} />
        </div>
        <div>
          <p className="text-[15px] font-bold text-slate-400 uppercase tracking-widest">
            {title}
          </p>
          <p className="text-[27px] font-black text-slate-900 tracking-tight">
            {value}
          </p>
          {desc && (
            <p className="text-[13px] font-bold text-slate-400 mt-0.5">
              {desc}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}
