import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { extractSalesRecord, ParsedSalesRow } from '@/utils/salesParser';
import { chatWithAI } from '@/lib/gemini';

export async function generateAutoReports(fileId: string, fileName: string, rows: any[], ownerId?: string): Promise<any[]> {
  if (!rows || rows.length === 0) return [];

  // Parse records
  const parsedRows: ParsedSalesRow[] = rows.map(r => extractSalesRecord(r));

  // Compute aggregation values for context
  let totalRevenue = 0;
  const productRevenue: Record<string, number> = {};
  const customerRevenue: Record<string, number> = {};
  const regionRevenue: Record<string, number> = {};

  parsedRows.forEach(item => {
    totalRevenue += item.revenue;
    productRevenue[item.product] = (productRevenue[item.product] || 0) + item.revenue;
    customerRevenue[item.customer] = (customerRevenue[item.customer] || 0) + item.revenue;
    regionRevenue[item.region] = (regionRevenue[item.region] || 0) + item.revenue;
  });

  // Sort mappings
  const sortedProducts = Object.entries(productRevenue).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const sortedCustomers = Object.entries(customerRevenue).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const sortedRegions = Object.entries(regionRevenue).sort((a, b) => b[1] - a[1]);

  const contextData = {
    fileName,
    totalRecords: parsedRows.length,
    totalRevenue,
    topProducts: sortedProducts.map(([k, v]) => ({ name: k, revenue: v })),
    topCustomers: sortedCustomers.map(([k, v]) => ({ name: k, revenue: v })),
    regions: sortedRegions.map(([k, v]) => ({ name: k, revenue: v }))
  };

  const reportTypes = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
  const createdReports: any[] = [];

  for (const type of reportTypes) {
    let focusInstruction = "";
    let cycleLabel = "";
    
    switch (type) {
      case 'DAILY':
        cycleLabel = "Hàng Ngày (Daily)";
        focusInstruction = "Tập trung phân tích sâu vào hoạt động vận hành chi tiết trong ngày, cơ cấu của các giao dịch nhỏ lẻ, danh sách sản phẩm khớp đơn nhanh, và đề xuất tối ưu hóa tốc độ đóng gói, vận chuyển, hoặc phản hồi khách hàng nhanh trong 24h tới.";
        break;
      case 'WEEKLY':
        cycleLabel = "Hàng Tuần (Weekly)";
        focusInstruction = "Tập trung phân tích và so sánh các kênh phân phối, sự bứt phá của các khu vực địa lý trong tuần qua, các nhóm khách hàng trung thành mua lặp lại nhiều lần, phân khúc sản phẩm đạt doanh số cao, và đề xuất kế hoạch phân bổ tồn kho hoặc chiến dịch xúc tiến bán hàng cho tuần tiếp theo.";
        break;
      case 'MONTHLY':
        cycleLabel = "Hàng Tháng (Monthly)";
        focusInstruction = "Tập trung phân tích bức tranh vĩ mô (Macro) của tháng, xu hướng thị trường, dự báo chu kỳ suy giảm hoặc bùng nổ, biên độ lợi nhuận đóng góp của từng dòng sản phẩm chủ lực, phân khúc khách hàng tiềm năng VIP vượt trội, và xây dựng các chiến lược cốt lõi dài hạn (tăng giá bán, kích cầu, tối ưu quy trình phân phối) cho tháng sau.";
        break;
    }

    const prompt = `Bạn là Giám đốc Phân tích Báo cáo Chiến lược (Chief Analytics Officer). Hãy soạn thảo một bản báo cáo phân tích hiệu suất kinh doanh ${cycleLabel} chuyên sâu bằng tiếng Việt chuẩn mực dựa trên dữ liệu tổng hợp thực tế sau đây từ tệp tin '${fileName}':

### SỐ LIỆU TỔNG HỢP:
- Tổng số bản ghi đơn hàng: ${contextData.totalRecords}
- Tổng Doanh Thu: ${formatVND(contextData.totalRevenue)}
- Top Sản Phẩm Bán Chạy:
${contextData.topProducts.map((p, i) => `${i + 1}. ${p.name}: ${formatVND(p.revenue)}`).join('\n')}
- Top Khách Hàng Giá Trị:
${contextData.topCustomers.map((c, i) => `${i + 1}. ${c.name}: ${formatVND(c.revenue)}`).join('\n')}
- Phân Bố Theo Khu Vực:
${contextData.regions.map(r => `- ${r.name}: ${formatVND(r.revenue)}`).join('\n')}

### CHỈ DẪN TRỌNG TÂM:
${focusInstruction}

### Yêu cầu định dạng báo cáo:
- Trả về kết quả bằng mã Markdown chuyên nghiệp, hoàn chỉnh, biểu cảm tốt.
- Bắt buộc phải có các tiêu mục chính:
  1. TÓM TẮT HIỆU SUẤT CHUNG (phản ánh chu kỳ báo cáo)
  2. BẢNG BIỂU CHI TIẾT SẢN PHẨM & KHÁCH HÀNG (Sử dụng cú pháp table Markdown | Cột 1 | Cột 2 | để vẽ bảng số liệu trực quan)
  3. PHÂN TÍCH CHUYÊN SÂU ĐỊA LÝ & KHÔNG GIAN
  4. ĐỀ XUẤT HÀNH ĐỘNG AI (Bao gồm ít nhất 3 đề xuất thực tế, bám sát số liệu)
- Văn phong cực kỳ chuyên nghiệp, khách quan, đáng tin cậy. Không sử dụng các emoji, icon bừa bãi. Chỉ sử dụng ngôn ngữ kinh tế chính luận Việt Nam.`;

    try {
      const response = await chatWithAI(prompt);
      const markdownContent = response.text || `# Báo cáo lỗi\nKhông thể tạo được nội dung báo cáo tự động tại thời điểm này.`;

      // Write direct to Firestore
      const reportRef = await addDoc(collection(db, 'reports'), {
        ownerId: ownerId || 'shared_user',
        createdBy: ownerId || 'shared_user',
        title: `Báo cáo ${type} Tự động - ${fileName} (${new Date().toLocaleDateString('vi-VN')})`,
        content: markdownContent,
        generatedBy: 'AI Sales Automation (LLM + RAG)',
        createdAt: serverTimestamp(),
        fileType: 'PDF',
        reportType: type
      });

      createdReports.push({
        id: reportRef.id,
        type,
        title: `Báo cáo ${type} Tự động - ${fileName}`
      });
    } catch (err) {
      console.error(`Failed to generate auto ${type} report:`, err);
    }
  }

  return createdReports;
}

function formatVND(value: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}
