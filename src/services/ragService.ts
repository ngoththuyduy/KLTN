import { writeBatch, collection, doc, updateDoc, getDocs, getDoc, query, where, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { recursiveSplit, convertRowsToText } from './chunkService';
import { getEmbedding, getEmbeddings, getEmbeddingWithRateLimit, getEmbeddingsInBatches } from './embeddingService';
import { searchChunks } from './vectorSearch';
import { chatWithAI } from '@/lib/gemini';
import { toast } from 'sonner';
import { extractSalesRecord } from '@/utils/salesParser';
import { getLocalFileRecords, getLocalFiles, DEFAULT_STANDARD_FILE, SAMPLE_5000_RECORDS } from '@/lib/fileStorage';

export interface RAGResponse {
  answer: string;
  citations: { fileName: string; text: string; score: number }[];
  usedCitations: string[];
  queryVector?: number[];
  systemInstruction?: string;
  retrievedContext?: string;
}

// In-memory caches to dramatically accelerate repeat RAG queries
const summaryCache = new Map<string, string>();
const recordsCache = new Map<string, { fileName: string; records: any[] }>();

export function computeFullDatasetSummary(fileName: string, rows: any[]): string {
  if (!rows || rows.length === 0) {
    return `[Tệp ${fileName} không có dữ liệu bản ghi]`;
  }

  const totalRows = rows.length;
  let totalRevenue = 0;
  let totalProfit = 0;
  let totalQuantity = 0;
  let minRevenue = Infinity;
  let maxRevenue = -Infinity;

  const datesSet = new Set<string>();
  const monthsSet = new Set<string>();
  interface GroupStat {
    sum: number;
    profit: number;
    count: number;
    qty: number;
    firstRow: number;
    lastRow: number;
    sampleRows: number[];
  }

  const regionMap: Record<string, GroupStat> = {};
  const categoryMap: Record<string, GroupStat> = {};
  const productMap: Record<string, GroupStat> = {};
  const monthlyMap: Record<string, GroupStat> = {};
  const paymentMap: Record<string, GroupStat> = {};
  const customerStatusMap: Record<string, GroupStat> = {};
  const sellerMap: Record<string, GroupStat> = {};
  const orderSet = new Set<string>();

  const findColVal = (row: any, candidateKeywords: string[], excludeKeywords: string[] = []) => {
    if (!row) return '';
    const keys = Object.keys(row);

    const normKeyMap = keys.map(k => ({
      originalKey: k,
      cleanWithSpace: k.toLowerCase().trim().replace(/\s+/g, ' '),
      cleanNoSpace: k.toLowerCase().replace(/[^a-z0-9à-ỹ]/g, '')
    }));

    // Filter out excluded keys
    const validKeys = normKeyMap.filter(item => {
      return !excludeKeywords.some(ex => {
        const exClean = ex.toLowerCase().replace(/[^a-z0-9à-ỹ]/g, '');
        return item.cleanNoSpace.includes(exClean);
      });
    });

    // Priority 1: Exact match on cleanWithSpace or cleanNoSpace
    for (const kw of candidateKeywords) {
      const kwSpace = kw.toLowerCase().trim().replace(/\s+/g, ' ');
      const kwNoSpace = kw.toLowerCase().replace(/[^a-z0-9à-ỹ]/g, '');
      const match = validKeys.find(k => k.cleanWithSpace === kwSpace || k.cleanNoSpace === kwNoSpace);
      if (match && row[match.originalKey] !== undefined && row[match.originalKey] !== null && String(row[match.originalKey]).trim() !== '') {
        return String(row[match.originalKey]).trim();
      }
    }

    // Priority 2: Substring contain match
    for (const kw of candidateKeywords) {
      const kwNoSpace = kw.toLowerCase().replace(/[^a-z0-9à-ỹ]/g, '');
      if (kwNoSpace.length < 2) continue;
      const match = validKeys.find(k => k.cleanNoSpace.includes(kwNoSpace) || kwNoSpace.includes(k.cleanNoSpace));
      if (match && row[match.originalKey] !== undefined && row[match.originalKey] !== null && String(row[match.originalKey]).trim() !== '') {
        return String(row[match.originalKey]).trim();
      }
    }

    return '';
  };

  rows.forEach((r, rowIdx) => {
    const excelRow = rowIdx + 2; // Data row starts at Excel Row 2
    const p = extractSalesRecord(r);
    const rev = p.revenue || (p.price * p.quantity) || 0;
    const prof = p.profit || 0;
    const qty = p.quantity > 0 ? p.quantity : 1;

    totalRevenue += rev;
    totalProfit += prof;
    totalQuantity += qty;

    if (rev > 0) {
      if (rev < minRevenue) minRevenue = rev;
      if (rev > maxRevenue) maxRevenue = rev;
    }

    if (p.customer) {
      orderSet.add(p.customer);
    }

    const updateGroupStat = (map: Record<string, GroupStat>, key: string) => {
      if (!map[key]) {
        map[key] = { sum: 0, profit: 0, count: 0, qty: 0, firstRow: excelRow, lastRow: excelRow, sampleRows: [] };
      }
      map[key].sum += rev;
      map[key].profit += prof;
      map[key].count += 1;
      map[key].qty += qty;
      map[key].lastRow = excelRow;
      if (map[key].sampleRows.length < 5) {
        map[key].sampleRows.push(excelRow);
      }
    };

    // Payment Method
    const payMethod = findColVal(
      r,
      ['hình thức thanh toán', 'hinh thuc thanh toan', 'phương thức thanh toán', 'phuong thuc thanh toan', 'thanh toán', 'thanh toan', 'payment method', 'payment', 'httt', 'pttt'],
      ['trạng thái', 'trang thai', 'ngày', 'ngay', 'mã', 'ma']
    );
    if (payMethod) updateGroupStat(paymentMap, payMethod);

    // Customer Status
    const custStatus = findColVal(
      r,
      ['trạng thái khách hàng', 'trang thai khach hang', 'trạng thái kh', 'trang thai kh', 'hạng khách hàng', 'hang khach hang', 'hạng kh', 'hang kh', 'phân hạng kh', 'loại khách hàng', 'loai khach hang', 'loại kh', 'customer status', 'customer tier', 'tier', 'trạng thái vip', 'vip status', 'khách hàng vip', 'hạng vip'],
      ['đơn hàng', 'don hang', 'giao hàng', 'giao hang', 'thanh toán', 'thanh toan', 'vận chuyển', 'van chuyen', 'xử lý', 'xu ly']
    );
    if (custStatus) updateGroupStat(customerStatusMap, custStatus);

    // Seller / Staff
    const sellerVal = p.seller || findColVal(
      r,
      ['nhân viên', 'nhan vien', 'nv bán hàng', 'nv ban hang', 'người bán', 'nguoi ban', 'nhân viên bán hàng', 'nhan vien ban hang', 'sale', 'seller', 'salesman', 'nhân viên xử lý'],
      ['khách hàng', 'khach hang']
    );
    if (sellerVal) updateGroupStat(sellerMap, sellerVal);

    if (p.date && !isNaN(p.date.getTime())) {
      const dStr = p.date.toISOString().slice(0, 10);
      const mStr = `${p.date.getFullYear()}-${String(p.date.getMonth() + 1).padStart(2, '0')}`;
      datesSet.add(dStr);
      monthsSet.add(mStr);
      updateGroupStat(monthlyMap, mStr);
    }

    if (p.region) updateGroupStat(regionMap, p.region);
    if (p.category) updateGroupStat(categoryMap, p.category);

    if (p.product) {
      const prodLabel = p.productCode ? `[${p.productCode}] ${p.product}` : p.product;
      updateGroupStat(productMap, prodLabel);
    }
  });

  if (minRevenue === Infinity) minRevenue = 0;
  if (maxRevenue === -Infinity) maxRevenue = 0;

  const orderCount = orderSet.size > 0 ? orderSet.size : totalRows;
  const avgRevenuePerOrder = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0;
  const avgProfitPerOrder = orderCount > 0 ? Math.round(totalProfit / orderCount) : 0;
  const avgRevenuePerRow = totalRows > 0 ? Math.round(totalRevenue / totalRows) : 0;
  const avgRevenuePerUnit = totalQuantity > 0 ? Math.round(totalRevenue / totalQuantity) : 0;

  const distinctDays = datesSet.size;
  const avgRevenuePerDay = distinctDays > 0 ? Math.round(totalRevenue / distinctDays) : 0;

  const distinctMonths = monthsSet.size;
  const avgRevenuePerMonth = distinctMonths > 0 ? Math.round(totalRevenue / distinctMonths) : 0;

  const formatVND = (v: number) => Math.round(v).toLocaleString('vi-VN') + ' ₫';

  // Payment Markdown Table
  let paymentText = '';
  let paymentMarkdownTable = '';
  const paymentEntries = Object.entries(paymentMap).sort((a, b) => b[1].count - a[1].count);
  if (paymentEntries.length > 0) {
    paymentText = paymentEntries.map(([method, data]) => {
      const avgOrder = data.count > 0 ? Math.round(data.sum / data.count) : 0;
      const avgProfit = data.count > 0 ? Math.round(data.profit / data.count) : 0;
      const pct = totalRows > 0 ? ((data.count / totalRows) * 100).toFixed(1) : '0';
      return `  - ${method}: ${data.count.toLocaleString('vi-VN')} đơn (${pct}% tổng tệp) | Doanh thu = ${formatVND(data.sum)} | Lợi nhuận = ${formatVND(data.profit)} | TB Doanh thu/đơn = ${formatVND(avgOrder)} | TB Lợi nhuận/đơn = ${formatVND(avgProfit)}`;
    }).join('\n');

    paymentMarkdownTable = `| Hình thức thanh toán | Số lượng đơn | Tỷ lệ đơn | Tổng doanh thu (VNĐ) | Tổng lợi nhuận (VNĐ) | Tỷ suất LN (%) | Doanh thu TB / đơn (VNĐ) | Lợi nhuận TB / đơn (VNĐ) |\n` +
      `|---|---|---|---|---|---|---|---|\n` +
      paymentEntries.map(([method, data]) => {
        const avgOrderRev = data.count > 0 ? Math.round(data.sum / data.count) : 0;
        const avgOrderProf = data.count > 0 ? Math.round(data.profit / data.count) : 0;
        const pct = totalRows > 0 ? ((data.count / totalRows) * 100).toFixed(1) : '0';
        const margin = data.sum > 0 ? ((data.profit / data.sum) * 100).toFixed(1) : '0';
        return `| ${method} | ${data.count.toLocaleString('vi-VN')} | ${pct}% | ${Math.round(data.sum).toLocaleString('vi-VN')} | ${Math.round(data.profit).toLocaleString('vi-VN')} | ${margin}% | ${avgOrderRev.toLocaleString('vi-VN')} | ${avgOrderProf.toLocaleString('vi-VN')} |`;
      }).join('\n');
  }

  // Customer Status Table
  let custStatusText = '';
  let custStatusMarkdownTable = '';
  const custStatusEntries = Object.entries(customerStatusMap).sort((a, b) => b[1].count - a[1].count);
  if (custStatusEntries.length > 0) {
    custStatusText = custStatusEntries.map(([status, data]) => {
      const avgOrder = data.count > 0 ? Math.round(data.sum / data.count) : 0;
      const avgProfit = data.count > 0 ? Math.round(data.profit / data.count) : 0;
      const pct = totalRows > 0 ? ((data.count / totalRows) * 100).toFixed(1) : '0';
      return `  - ${status}: ${data.count.toLocaleString('vi-VN')} đơn (${pct}% tổng tệp) | Doanh thu = ${formatVND(data.sum)} | Lợi nhuận = ${formatVND(data.profit)} | TB Doanh thu/đơn = ${formatVND(avgOrder)} | TB Lợi nhuận/đơn = ${formatVND(avgProfit)}`;
    }).join('\n');

    custStatusMarkdownTable = `| Trạng thái khách hàng | Số lượng đơn | Tỷ lệ đơn | Tổng doanh thu (VNĐ) | Tổng lợi nhuận (VNĐ) | Tỷ suất LN (%) | Doanh thu TB / đơn (VNĐ) | Lợi nhuận TB / đơn (VNĐ) |\n` +
      `|---|---|---|---|---|---|---|---|\n` +
      custStatusEntries.map(([status, data]) => {
        const avgOrderRev = data.count > 0 ? Math.round(data.sum / data.count) : 0;
        const avgOrderProf = data.count > 0 ? Math.round(data.profit / data.count) : 0;
        const pct = totalRows > 0 ? ((data.count / totalRows) * 100).toFixed(1) : '0';
        const margin = data.sum > 0 ? ((data.profit / data.sum) * 100).toFixed(1) : '0';
        return `| ${status} | ${data.count.toLocaleString('vi-VN')} | ${pct}% | ${Math.round(data.sum).toLocaleString('vi-VN')} | ${Math.round(data.profit).toLocaleString('vi-VN')} | ${margin}% | ${avgOrderRev.toLocaleString('vi-VN')} | ${avgOrderProf.toLocaleString('vi-VN')} |`;
      }).join('\n');
  }

  // Seller Table
  let sellerText = '';
  let sellerMarkdownTable = '';
  const sellerEntries = Object.entries(sellerMap).sort((a, b) => b[1].sum - a[1].sum);
  if (sellerEntries.length > 0) {
    sellerText = sellerEntries.map(([sellerName, data]) => {
      const avgOrder = data.count > 0 ? Math.round(data.sum / data.count) : 0;
      const avgProfit = data.count > 0 ? Math.round(data.profit / data.count) : 0;
      const sampleStr = data.sampleRows && data.sampleRows.length > 0 ? ` (ví dụ Dòng Excel: ${data.sampleRows.join(', ')} ... đến Dòng Excel ${data.lastRow})` : '';
      return `  - ${sellerName}: Doanh thu = ${formatVND(data.sum)} | Lợi nhuận = ${formatVND(data.profit)} (${data.count} đơn hàng) | Phạm vi: Dòng Excel ${data.firstRow} đến Dòng Excel ${data.lastRow}${sampleStr} | TB Doanh thu/đơn = ${formatVND(avgOrder)} | TB Lợi nhuận/đơn = ${formatVND(avgProfit)}`;
    }).join('\n');

    sellerMarkdownTable = `| Nhân viên bán hàng | Doanh thu | Lợi nhuận | Tỷ suất LN (%) | Số lượng đơn | Doanh thu TB / đơn | Lợi nhuận TB / đơn |\n` +
      `|---|---|---|---|---|---|---|\n` +
      sellerEntries.map(([sellerName, data]) => {
        const avgOrderRev = data.count > 0 ? Math.round(data.sum / data.count) : 0;
        const avgOrderProf = data.count > 0 ? Math.round(data.profit / data.count) : 0;
        const margin = data.sum > 0 ? ((data.profit / data.sum) * 100).toFixed(1) : '0';
        return `| ${sellerName} | ${Math.round(data.sum).toLocaleString('vi-VN')} | ${Math.round(data.profit).toLocaleString('vi-VN')} | ${margin}% | ${data.count.toLocaleString('vi-VN')} | ${avgOrderRev.toLocaleString('vi-VN')} | ${avgOrderProf.toLocaleString('vi-VN')} |`;
      }).join('\n');
  }

  let regionText = '';
  let regionMarkdownTable = '';
  const regionEntries = Object.entries(regionMap).sort((a, b) => b[1].sum - a[1].sum);
  if (regionEntries.length > 0) {
    regionText = regionEntries.map(([regName, data]) => {
      const avgOrder = data.count > 0 ? Math.round(data.sum / data.count) : 0;
      const avgProfit = data.count > 0 ? Math.round(data.profit / data.count) : 0;
      const share = totalRevenue > 0 ? ((data.sum / totalRevenue) * 100).toFixed(1) : '0';
      const sampleStr = data.sampleRows && data.sampleRows.length > 0 ? ` (ví dụ Dòng Excel: ${data.sampleRows.join(', ')} ... đến Dòng Excel ${data.lastRow})` : '';
      return `  - ${regName}: Doanh thu = ${formatVND(data.sum)} (${share}% tổng tệp) | Lợi nhuận = ${formatVND(data.profit)} | Số lượng: ${data.count.toLocaleString('vi-VN')} đơn | Phạm vi Dòng Excel: Tổng cộng từ ${data.count.toLocaleString('vi-VN')} dòng đơn hàng thuộc ${regName}, nằm từ Dòng Excel ${data.firstRow} đến Dòng Excel ${data.lastRow}${sampleStr} | TB Doanh thu/đơn = ${formatVND(avgOrder)} | TB Lợi nhuận/đơn = ${formatVND(avgProfit)}`;
    }).join('\n');

    regionMarkdownTable = `| Khu vực | Doanh thu | Lợi nhuận | Tỷ suất LN (%) | Tổng số đơn hàng | Doanh thu TB / đơn | Lợi nhuận TB / đơn |\n` +
      `|---|---|---|---|---|---|---|\n` +
      regionEntries.map(([regName, data]) => {
        const avgOrderRev = data.count > 0 ? Math.round(data.sum / data.count) : 0;
        const avgOrderProf = data.count > 0 ? Math.round(data.profit / data.count) : 0;
        const margin = data.sum > 0 ? ((data.profit / data.sum) * 100).toFixed(1) : '0';
        return `| ${regName} | ${Math.round(data.sum).toLocaleString('vi-VN')} | ${Math.round(data.profit).toLocaleString('vi-VN')} | ${margin}% | ${data.count.toLocaleString('vi-VN')} | ${avgOrderRev.toLocaleString('vi-VN')} | ${avgOrderProf.toLocaleString('vi-VN')} |`;
      }).join('\n');
  }

  let categoryText = '';
  let categoryMarkdownTable = '';
  const categoryEntries = Object.entries(categoryMap).sort((a, b) => b[1].sum - a[1].sum);
  if (categoryEntries.length > 0) {
    categoryText = categoryEntries.map(([catName, data]) => {
      const avgOrder = data.count > 0 ? Math.round(data.sum / data.count) : 0;
      const avgProfit = data.count > 0 ? Math.round(data.profit / data.count) : 0;
      const share = totalRevenue > 0 ? ((data.sum / totalRevenue) * 100).toFixed(1) : '0';
      const sampleStr = data.sampleRows && data.sampleRows.length > 0 ? ` (ví dụ Dòng Excel: ${data.sampleRows.join(', ')} ... đến Dòng Excel ${data.lastRow})` : '';
      return `  - ${catName}: Doanh thu = ${formatVND(data.sum)} (${share}% tổng tệp) | Lợi nhuận = ${formatVND(data.profit)} | Số lượng: ${data.qty} SP (${data.count} đơn) | Phạm vi: Dòng Excel ${data.firstRow} đến Dòng Excel ${data.lastRow}${sampleStr} | TB Doanh thu/đơn = ${formatVND(avgOrder)}`;
    }).join('\n');

    categoryMarkdownTable = `| Danh mục sản phẩm | Doanh thu | Lợi nhuận | Tỷ suất LN (%) | Số lượng SP | Số đơn hàng | Doanh thu TB / đơn | Lợi nhuận TB / đơn |\n` +
      `|---|---|---|---|---|---|---|---|\n` +
      categoryEntries.map(([catName, data]) => {
        const avgOrderRev = data.count > 0 ? Math.round(data.sum / data.count) : 0;
        const avgOrderProf = data.count > 0 ? Math.round(data.profit / data.count) : 0;
        const margin = data.sum > 0 ? ((data.profit / data.sum) * 100).toFixed(1) : '0';
        return `| ${catName} | ${Math.round(data.sum).toLocaleString('vi-VN')} | ${Math.round(data.profit).toLocaleString('vi-VN')} | ${margin}% | ${data.qty.toLocaleString('vi-VN')} | ${data.count.toLocaleString('vi-VN')} | ${avgOrderRev.toLocaleString('vi-VN')} | ${avgOrderProf.toLocaleString('vi-VN')} |`;
      }).join('\n');
  }

  let productText = '';
  const productEntries = Object.entries(productMap).sort((a, b) => b[1].sum - a[1].sum).slice(0, 30);
  if (productEntries.length > 0) {
    productText = productEntries.map(([prodName, data]) => {
      const avgPerUnit = data.qty > 0 ? Math.round(data.sum / data.qty) : 0;
      const avgPerRow = data.count > 0 ? Math.round(data.sum / data.count) : 0;
      const sampleStr = data.sampleRows && data.sampleRows.length > 0 ? ` (ví dụ Dòng Excel: ${data.sampleRows.join(', ')} ... đến Dòng Excel ${data.lastRow})` : '';
      return `  - ${prodName}: Doanh thu = ${formatVND(data.sum)} | Lợi nhuận = ${formatVND(data.profit)} | Số lượng: ${data.qty} SP (${data.count} đơn) | Phạm vi: Dòng Excel ${data.firstRow} đến Dòng Excel ${data.lastRow}${sampleStr} | TB Doanh thu/SP = ${formatVND(avgPerUnit)}`;
    }).join('\n');
  }

  let monthlyText = '';
  let monthlyMarkdownTable = '';
  const monthlyEntries = Object.entries(monthlyMap).sort((a, b) => a[0].localeCompare(b[0]));
  if (monthlyEntries.length > 0) {
    monthlyText = monthlyEntries.map(([mStr, data]) => {
      const avgOrder = data.count > 0 ? Math.round(data.sum / data.count) : 0;
      const avgProfit = data.count > 0 ? Math.round(data.profit / data.count) : 0;
      const sampleStr = data.sampleRows && data.sampleRows.length > 0 ? ` (ví dụ Dòng Excel: ${data.sampleRows.join(', ')} ... đến Dòng Excel ${data.lastRow})` : '';
      return `  - Tháng ${mStr}: Doanh thu = ${formatVND(data.sum)} | Lợi nhuận = ${formatVND(data.profit)} | Số lượng: ${data.count} đơn | Phạm vi: Dòng Excel ${data.firstRow} đến Dòng Excel ${data.lastRow}${sampleStr} | TB Doanh thu/đơn = ${formatVND(avgOrder)}`;
    }).join('\n');

    monthlyMarkdownTable = `| Tháng | Doanh thu | Lợi nhuận | Tỷ suất LN (%) | Số lượng đơn | Doanh thu TB / đơn | Lợi nhuận TB / đơn |\n` +
      `|---|---|---|---|---|---|---|\n` +
      monthlyEntries.map(([mStr, data]) => {
        const avgOrderRev = data.count > 0 ? Math.round(data.sum / data.count) : 0;
        const avgOrderProf = data.count > 0 ? Math.round(data.profit / data.count) : 0;
        const margin = data.sum > 0 ? ((data.profit / data.sum) * 100).toFixed(1) : '0';
        return `| Tháng ${mStr} | ${Math.round(data.sum).toLocaleString('vi-VN')} | ${Math.round(data.profit).toLocaleString('vi-VN')} | ${margin}% | ${data.count.toLocaleString('vi-VN')} | ${avgOrderRev.toLocaleString('vi-VN')} | ${avgOrderProf.toLocaleString('vi-VN')} |`;
      }).join('\n');
  }

  const overallMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(2) : '0';

  return `[BÁO CÁO THỐNG KÊ TỔNG QUAN XÁC THỰC TOÀN BỘ TỆP - DỮ LIỆU CHÍNH XÁC 100% CỦA TỆP "${fileName}"]:
• Tổng số dòng bản ghi dữ liệu thực tế: ${totalRows.toLocaleString('vi-VN')} dòng
• TỔNG DOANH THU TOÀN TỆP (Total Revenue): ${formatVND(totalRevenue)}
• TỔNG LỢI NHUẬN TOÀN TỆP (Total Profit): ${formatVND(totalProfit)}
• TỶ SUẤT LỢI NHUẬN TỔNG THỂ (Overall Profit Margin): ${overallMargin}%
• TỔNG SỐ LƯỢNG SẢN PHẨM BÁN RA: ${totalQuantity.toLocaleString('vi-VN')} sản phẩm

[QUY TẮC TRÍCH DẪN TÊN CỘT THỰC TẾ TRONG FILE EXCEL]:
- Trong file Excel thực tế, tên các cột chính xác bao gồm: Cột "Doanh thu", Cột "Lợi nhuận", Cột "Khu vực", Cột "Danh mục sản phẩm", Cột "Tên nhân viên", Cột "Sản phẩm", Cột "Mã đơn hàng", Cột "Số lượng", Cột "Giá bán"...
- Khi trích dẫn nguồn gốc dữ liệu cho số liệu tổng hợp (ví dụ: Tổng doanh thu Miền Bắc), bạn PHẢI trích dẫn tên cột thực tế trong tệp như sau:
  + Tệp: "${fileName}"
  + Cột trích xuất: Cột "Doanh thu" (tổng hợp theo Cột "Khu vực": "Miền Bắc")
  + TUYỆT ĐỐI KHÔNG bịa ra tên cột không có thực như "Tổng doanh thu (VNĐ)" hay tự thêm tên bảng giả định.

[CÁC CHỈ SỐ GIÁ TRỊ TRUNG BÌNH CHÍNH XÁC CỦA TỆP "${fileName}"]:
1. GIÁ TRỊ ĐƠN HÀNG TRUNG BÌNH (AOV - Doanh thu & Lợi nhuận trung bình / đơn):
   👉 Doanh thu TB / đơn: ${formatVND(avgRevenuePerOrder)}
   👉 Lợi nhuận TB / đơn: ${formatVND(avgProfitPerOrder)}
   (Công thức: Tổng doanh thu ${formatVND(totalRevenue)} & Lợi nhuận ${formatVND(totalProfit)} ÷ ${orderCount.toLocaleString('vi-VN')} đơn)

2. DOANH THU TRUNG BÌNH TRÊN MỖI ĐƠN VỊ SẢN PHẨM:
   👉 ${formatVND(avgRevenuePerUnit)} / sản phẩm

${distinctDays > 0 ? `3. DOANH THU TRUNG BÌNH MỖI NGÀY:
   👉 ${formatVND(avgRevenuePerDay)} / ngày (Tính trên ${distinctDays} ngày có giao dịch)` : ''}

${distinctMonths > 0 ? `4. DOANH THU TRUNG BÌNH MỖI THÁNG:
   👉 ${formatVND(avgRevenuePerMonth)} / tháng (Tính trên ${distinctMonths} tháng ghi nhận)` : ''}

• Khoảng doanh thu đơn hàng: Thấp nhất = ${formatVND(minRevenue)} | Cao nhất = ${formatVND(maxRevenue)}

${regionMarkdownTable ? `[THỐNG KÊ TỔNG HỢP THEO KHU VỰC (${totalRows.toLocaleString('vi-VN')} DÒNG)]:\n${regionMarkdownTable}\n` : ''}
${regionText ? `[CHI TIẾT KHU VỰC]:\n${regionText}\n` : ''}
${categoryMarkdownTable ? `[THỐNG KÊ TỔNG HỢP THEO DANH MỤC SẢN PHẨM (${totalRows.toLocaleString('vi-VN')} DÒNG)]:\n${categoryMarkdownTable}\n` : ''}
${categoryText ? `[CHI TIẾT DANH MỤC SẢN PHẨM]:\n${categoryText}\n` : ''}
${sellerMarkdownTable ? `[THỐNG KÊ TỔNG HỢP THEO NHÂN VIÊN BÁN HÀNG (${totalRows.toLocaleString('vi-VN')} DÒNG)]:\n${sellerMarkdownTable}\n` : ''}
${sellerText ? `[CHI TIẾT NHÂN VIÊN BÁN HÀNG]:\n${sellerText}\n` : ''}
${paymentMarkdownTable ? `[THỐNG KÊ TỔNG HỢP THEO HÌNH THỨC THANH TOÁN (${totalRows.toLocaleString('vi-VN')} DÒNG)]:\n${paymentMarkdownTable}\n` : ''}
${paymentText ? `[CHI TIẾT THANH TOÁN]:\n${paymentText}\n` : ''}
${custStatusMarkdownTable ? `[BẢNG THỐNG KÊ CHI TIẾT THEO TRẠNG THÁI KHÁCH HÀNG - CHÍNH XÁC 100% TOÀN TỆP (${totalRows.toLocaleString('vi-VN')} DÒNG)]:\n${custStatusMarkdownTable}\n` : ''}
${custStatusText ? `[CHI TIẾT TRẠNG THÁI KHÁCH HÀNG]:\n${custStatusText}\n` : ''}
${monthlyMarkdownTable ? `[BẢNG THỐNG KÊ DOANH THU & LỢI NHUẬN THEO THÁNG - CHÍNH XÁC 100% TOÀN TỆP (${totalRows.toLocaleString('vi-VN')} DÒNG)]:\n${monthlyMarkdownTable}\n` : ''}
${monthlyText ? `[CHI TIẾT THEO THÁNG]:\n${monthlyText}\n` : ''}
${productText ? `[DOANH THU & LỢI NHUẬN TRUNG BÌNH THEO SẢN PHẨM / TÊN HÀNG]:\n${productText}\n` : ''}

[YÊU CẦU BẮT BUỘC DÀNH CHO AI TRẢ LỜI]:
1. Hệ thống ĐÃ TỰ ĐỘNG TÍNH TOÁN VÀ TỔNG HỢP TOÀN BỘ DỮ LIỆU 5.000 DÒNG của tệp Excel vào các BẢNG THỐNG KÊ CHI TIẾT ở trên (bao gồm Doanh thu, Lợi nhuận, Số lượng đơn, Tỷ suất lợi nhuận theo Khu vực, Danh mục, Nhân viên, Trạng thái khách hàng, Hình thức thanh toán, Tháng...).
2. Khi người dùng hỏi bất kỳ câu hỏi nào về Doanh thu, Lợi nhuận, Tỷ suất lợi nhuận, Số đơn hàng hay Giá trị trung bình theo từng nhóm (Khu vực, Danh mục, Nhân viên, Trạng thái khách hàng...), bạn BẮT BUỘC phải trích dẫn trực tiếp từ các bảng thống kê 100% chính xác ở trên.
3. TUYỆT ĐỐI KHÔNG ĐƯỢC trả lời rằng "chưa có bảng thống kê" hay "không thể xác định khu vực nào có lợi nhuận cao nhất". Tất cả dữ liệu thống kê ĐÃ CÓ SẴN 100% trong Context ở trên!
4. Khi người dùng hỏi tổng thể về bất kỳ nhóm thuộc tính hay phân loại nào (như Hình thức thanh toán, Trạng thái khách hàng, Nhân viên, Khu vực, Danh mục...), bạn BẮT BUỘC phải xuất BẢNG THỐNG KÊ ĐẦY ĐỦ VÀ CHÍNH XÁC 100% trên toàn bộ tệp (ví dụ 5,000 dòng) từ các bảng thống kê ở trên.
5. Tuyệt đối KHÔNG tự tính toán hay cộng nhẩm từ các dòng mẫu vector context vì vector context chỉ là mẫu đại diện!`;
}

export async function ingestUploadedFile(fileId: string, fileName: string, rows: any[], ownerId?: string) {
  if (!rows || rows.length === 0) return;

  const chunks: string[] = [];

  // Add full 100% dataset summary chunk first
  const fullSummaryChunk = computeFullDatasetSummary(fileName, rows);
  chunks.push(fullSummaryChunk);

  // Rule 4: Schema explanation
  const isLargeFile = rows.length > 100;
  if (isLargeFile) {
    const columns = Object.keys(rows[0] || {});
    const schemaText = `[CẤU TRÚC DỮ LIỆU TÀI LIỆU - SCHEMA & LOGIC TRUY VẤN]:
Chi tiết tệp nguồn dữ liệu: "${fileName}"
Tổng số dòng bản ghi: ${rows.length} dòng dữ liệu thực tế.
Danh sách các cột tiêu đề (Columns Schema): ${columns.join(', ')}

[LẬP LUẬN LOGIC TRUY VẤN - SYSTEM PROMPT METADATA]:
Tập tin dữ liệu bán hàng này gồm các trường thông tin chính:
${columns.map(col => `- Cột [${col}]: trường dữ liệu ghi nhận thông tin tương ứng.`).join('\n')}

Mô hình AI khi nhận câu hỏi liên quan đến bất kỳ cột nào ở trên sẽ dựa vào cấu trúc này để định hướng phân tích thống kê và truy xuất dữ liệu phù hợp.`;
    chunks.push(schemaText);
  }

  // Process 100% of rows in smart dynamic batches so every single row is indexed in RAG quickly
  const BATCH_SIZE = rows.length > 2000 ? 100 : (rows.length > 500 ? 50 : 25);
  const representativeRows = rows;

  for (let i = 0; i < representativeRows.length; i += BATCH_SIZE) {
    const rowBatch = representativeRows.slice(i, i + BATCH_SIZE);
    const batchText = `[Cụm Dữ Liệu Bán Hàng - Bản ghi từ ${i + 1} đến ${i + rowBatch.length} từ tệp "${fileName}"]:
` + convertRowsToText(rowBatch, i + 2);
    chunks.push(batchText);
  }

  if (chunks.length === 0) return;

  console.log(`[SmartHub RAG] Formatted file ingestion into ${chunks.length} chunks. Fetching all embeddings using highly optimized smart batching...`);

  let embeddings: number[][] = [];
  try {
    embeddings = await getEmbeddingsInBatches(chunks, 20);
  } catch (err) {
    console.warn("Optimized smart batch embedding failed. Attempting standard batch as fallback:", err);
    try {
      embeddings = await getEmbeddings(chunks);
    } catch (fallbackErr) {
      console.error("All embedding attempts failed. Marking ingestion as failed:", fallbackErr);
      await updateDoc(doc(db, 'files', fileId), {
        embeddingStatus: 'FAILED',
        lastError: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      }).catch(() => {});
      throw fallbackErr;
    }
  }

  if (embeddings.length < chunks.length) {
    const message = `Embedding count mismatch: expected ${chunks.length}, got ${embeddings.length}`;
    await updateDoc(doc(db, 'files', fileId), {
      embeddingStatus: 'FAILED',
      lastError: message
    }).catch(() => {});
    throw new Error(message);
  }

  console.log(`[SmartHub RAG] Completed embedding generation. Committing ${chunks.length} chunks...`);
  
  // Chunk batch writes to avoid Firestore 500 batch limit
  for (let b = 0; b < chunks.length; b += 400) {
    const batch = writeBatch(db);
    const chunkSlice = chunks.slice(b, b + 400);
    chunkSlice.forEach((chunkText, index) => {
      const globalIndex = b + index;
      const chunkRef = doc(collection(db, 'knowledge_chunks'));
      const embedding = embeddings[globalIndex];
      if (!embedding) {
        throw new Error(`Missing embedding for chunk ${globalIndex}`);
      }

      batch.set(chunkRef, {
        id: chunkRef.id,
        ownerId: ownerId || 'shared_user',
        createdBy: ownerId || 'shared_user',
        sourceFileId: fileId,
        sourceFile: fileName,
        text: chunkText,
        embedding: embedding,
        createdAt: new Date()
      });
    });
    await batch.commit();
  }

  // Auto update file document to READY in Firestore with precomputed summary
  summaryCache.set(fileId, fullSummaryChunk);
  recordsCache.set(fileId, { fileName, records: rows });

  try {
    await updateDoc(doc(db, 'files', fileId), {
      status: 'COMPLETED',
      embeddingStatus: 'READY',
      computedSummary: fullSummaryChunk
    });
    console.log(`[SmartHub RAG] File ${fileName} successfully updated to COMPLETED & READY with precomputed summary.`);
  } catch (updErr) {
    console.warn("Failed to update file document status to READY:", updErr);
  }
}

export function findMatchingRowRecords(allFileRecords: { fileName: string; records: any[] }[], userQuestion: string): string {
  if (!allFileRecords || allFileRecords.length === 0) return '';
  
  // Stop-words list for general aggregate / statistical queries
  const stopWords = new Set([
    'tổng', 'doanh', 'thu', 'lợi', 'nhuận', 'trung', 'bình', 'khu', 'vực', 'danh', 'mục', 
    'nhân', 'viên', 'trạng', 'thái', 'hình', 'thức', 'thanh', 'toán', 'tháng', 'ngày', 'năm', 
    'sản', 'phẩm', 'số', 'lượng', 'cho', 'tôi', 'biết', 'báo', 'cáo', 'thống', 'kê', 'bao', 
    'nhiêu', 'nhất', 'như', 'thế', 'nào', 'là', 'gì', 'của', 'các', 'những', 'đơn', 'hàng', 
    'tất', 'cả', 'bao', 'nhiêu', 'tỷ', 'lệ', 'phần', 'trăm', 'giá', 'trị', 'aov', 'miền', 
    'bắc', 'nam', 'trung', 'bán', 'chạy', 'tốt', 'cao', 'thấp', 'ở', 'tại', 'về', 'trong',
    'theo', 'hãy', 'với', 'phân', 'tích', 'chi', 'tiết', 'toàn', 'bộ', 'tệp', 'excel', 'file',
    'giúp', 'mới', 'hiện', 'tất', 'cả', 'hỏi', 'cần'
  ]);

  const rawTokens = userQuestion.match(/[A-Za-z0-9_À-ỹ\-]{2,30}/g) || [];
  const meaningfulTokens = Array.from(new Set(
    rawTokens
      .map(t => t.toLowerCase())
      .filter(t => t.length >= 2 && !stopWords.has(t))
  ));

  // If query consists only of general analytical or aggregate words, skip row sampling
  if (meaningfulTokens.length === 0) return '';

  const matchedItems: { fileName: string; excelRow: number; detail: string; score: number }[] = [];

  for (const item of allFileRecords) {
    const { fileName, records } = item;
    records.forEach((row, idx) => {
      const excelRow = idx + 2; // Row 1 is header
      const rowValues = Object.entries(row)
        .filter(([k]) => k !== 'fileId' && k !== 'id' && !k.startsWith('_'))
        .map(([k, v]) => `${k}:${v}`)
        .join(' ')
        .toLowerCase();

      let score = 0;
      for (const token of meaningfulTokens) {
        if (rowValues.includes(token)) {
          // Give high weight to codes, numbers, order IDs, product IDs
          if (/\d/.test(token) || token.includes('_') || token.length >= 5) {
            score += 100;
          } else {
            score += 10;
          }
        }
      }

      if (score > 0) {
        const detail = Object.entries(row)
          .filter(([k]) => k !== 'fileId' && k !== 'id' && !k.startsWith('_'))
          .map(([k, v]) => `Cột "${k}": ${v}`)
          .join(', ');
        matchedItems.push({ fileName, excelRow, detail, score });
      }
    });
  }

  if (matchedItems.length === 0) return '';

  matchedItems.sort((a, b) => b.score - a.score);
  const topMatches = matchedItems.slice(0, 35);

  return `[TRÍCH XUẤT CÁC BẢN GHI DỮ LIỆU EXCEL KHỚP CHÍNH XÁC VỚI CÂU HỎI]:\n` +
    topMatches.map(m => `[Dòng Excel ${m.excelRow} (tệp: ${m.fileName})] ${m.detail}`).join('\n');
}

export async function queryRAG(
  userQuestion: string,
  sourceFiles?: string[],
  history: any[] = [],
  topK = 10,
  threshold = 0.35,
  ownerId?: string
): Promise<RAGResponse> {
  // If no source files are selected, or there are no documents chosen, allow conversational assistant support
  if (!sourceFiles || sourceFiles.length === 0) {
    const systemInstruction = `Bạn là AI Sales Intelligence Assistant. Người dùng chưa chọn hoặc chưa tải lên bất kỳ dữ liệu bán hàng nào vào cuộc trò chuyện. 
HÃY trả lời một cách lịch sự, thân thiện bằng tiếng Việt. 
Hướng dẫn họ cách sử dụng: "Để tối ưu phân tích dữ liệu bán hàng, hãy tải tập tin Excel lên ở phần 'Quản lý dữ liệu', sau đó tích chọn nguồn dữ liệu tương ứng ở thanh bên trái của trang 'Trợ lý AI' trước khi đặt câu hỏi số liệu." 
Đồng thời, bạn vẫn có thể trả lời các câu hỏi chung hoặc làm thơ, hướng dẫn, chào hỏi thân mật... dựa trên câu hỏi của họ.`;
    
    try {
      const chatResponse = await chatWithAI(userQuestion, history, systemInstruction);
      return {
        answer: chatResponse.text,
        citations: [],
        usedCitations: []
      };
    } catch (err) {
      console.error("General chat fallback failed:", err);
      return {
        answer: "Chào bạn! Trợ lý AI đang sẵn sàng, tuy nhiên việc kết nối với máy chủ AI đang gặp rắc rối nhỏ. Hãy kiểm tra khóa API trong tệp cấu hình của bạn hoặc thử lại nhé.",
        citations: [],
        usedCitations: []
      };
    }
  }

  // Fetch live records from Firestore for selected or all active completed files to compute 100% accurate dataset-wide statistics
  let liveSummaries = '';
  let activeFileIds = sourceFiles && sourceFiles.length > 0 ? sourceFiles : [];
  const allLoadedRecords: { fileName: string; records: any[] }[] = [];

  if (activeFileIds.length === 0) {
    try {
      const allCompletedFilesSnap = ownerId
        ? await getDocs(query(collection(db, 'files'), where('ownerId', '==', ownerId), where('status', '==', 'COMPLETED')))
        : await getDocs(query(collection(db, 'files'), where('status', '==', 'COMPLETED')));
      activeFileIds = allCompletedFilesSnap.docs.map(d => d.id);
    } catch (err) {
      console.warn("Could not auto-fetch completed files for summary:", err);
    }
  }

  // Filter out default sample files if real user files exist
  const sampleIds = [DEFAULT_STANDARD_FILE.id, 'standard_default_sample_file', 'default_sales_sample'];
  const hasRealUserFile = activeFileIds.some(id => !sampleIds.includes(id));
  if (hasRealUserFile) {
    activeFileIds = activeFileIds.filter(id => !sampleIds.includes(id));
  }

  if (activeFileIds.length > 0) {
    try {
      for (const fileId of activeFileIds) {
        // 1. Fast path: check summaryCache memory
        if (summaryCache.has(fileId)) {
          liveSummaries += `\n\n${summaryCache.get(fileId)}`;
          if (recordsCache.has(fileId)) {
            allLoadedRecords.push(recordsCache.get(fileId)!);
          }
          continue;
        }

        let records: any[] = [];
        let fileName = 'DATA.xlsx';

        if (fileId === DEFAULT_STANDARD_FILE.id || fileId === 'standard_default_sample_file' || fileId === 'default_sales_sample') {
          records = SAMPLE_5000_RECORDS;
          fileName = DEFAULT_STANDARD_FILE.fileName;
          const computed = computeFullDatasetSummary(fileName, records);
          summaryCache.set(fileId, computed);
          liveSummaries += `\n\n${computed}`;
          const item = { fileName, records };
          recordsCache.set(fileId, item);
          allLoadedRecords.push(item);
          continue;
        }

        let fileDocSnap: any = null;
        try {
          fileDocSnap = await getDoc(doc(db, 'files', fileId));
        } catch (fErr) {
          console.warn("Doc fetch notice:", fErr);
        }

        if (fileDocSnap && fileDocSnap.exists()) {
          const fileData = fileDocSnap.data();
          fileName = fileData?.fileName || 'DATA.xlsx';
          
          if (fileData?.computedSummary) {
            summaryCache.set(fileId, fileData.computedSummary);
            liveSummaries += `\n\n${fileData.computedSummary}`;
            if (Array.isArray(fileData?.records) && fileData.records.length > 0) {
              const item = { fileName, records: fileData.records };
              recordsCache.set(fileId, item);
              allLoadedRecords.push(item);
            }
            continue;
          }

          if (Array.isArray(fileData?.records) && fileData.records.length > 0) {
            records = fileData.records;
          } else {
            try {
              const recordsSnap = await getDocs(query(collection(db, `files/${fileId}/records`), limit(10000)));
              if (!recordsSnap.empty) {
                records = recordsSnap.docs.map(d => d.data());
              }
            } catch (rErr) {
              console.warn("Records collection fetch notice:", rErr);
            }
          }
        }

        if (records.length === 0) {
          const localRecs = getLocalFileRecords(fileId);
          if (localRecs && localRecs.length > 0) {
            records = localRecs;
            const matchedLocalFile = getLocalFiles().find(f => f.id === fileId);
            if (matchedLocalFile) fileName = matchedLocalFile.fileName;
          }
        }

        if (records.length > 0) {
          const recItem = { fileName, records };
          recordsCache.set(fileId, recItem);
          allLoadedRecords.push(recItem);

          const summaryText = computeFullDatasetSummary(fileName, records);
          summaryCache.set(fileId, summaryText);
          liveSummaries += `\n\n${summaryText}`;

          updateDoc(doc(db, 'files', fileId), { computedSummary: summaryText }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn("Dynamic dataset summary computation skipped or failed:", err);
    }
  }

  const directMatchedRowsText = findMatchingRowRecords(allLoadedRecords, userQuestion);

  // 1. Generate text embedding for the user's question
  let queryVector: number[] = [];
  try {
    queryVector = await getEmbedding(userQuestion);
  } catch (err) {
    console.warn("Embedding generation failed, will fallback to conversational mode:", err);
  }

  if (!queryVector || queryVector.length === 0) {
    const systemInstruction = `Bạn là AI Sales Intelligence Assistant. Việc truy xuất dữ liệu tạm thời bị gián đoạn vì lỗi vector hóa. Hãy cố gắng trả lời câu hỏi của người dùng một cách tốt nhất dựa trên lịch sử tin nhắn và kiến thức chung.`;
    try {
      const chatResponse = await chatWithAI(userQuestion, history, systemInstruction);
      return {
        answer: chatResponse.text,
        citations: [],
        usedCitations: []
      };
    } catch (err) {
      console.error("Embedding fallback chat failed:", err);
      return {
        answer: "Chào bạn! Quá trình phân tích dữ liệu đang bị gián đoạn do sự cố kết nối máy chủ AI. Xin vui lòng thử lại sau giây lát.",
        citations: [],
        usedCitations: []
      };
    }
  }
  
  // 2. Perform cosine similarity vector search over Firestore knowledge chunks
  const searchResults = await searchChunks(queryVector, topK, sourceFiles, ownerId);
  
  // 3. Use similarity scoring thresholds to prevent hallucinations
  let filteredResults = searchResults.filter(r => r.score >= threshold);
  
  // Direct code match rescue: Check if question contains specific identifiers (e.g. SP113, DH_04012, etc.)
  const rawTokens = userQuestion.match(/[A-Za-z0-9_\-]{3,20}/g) || [];
  const specificCodes = Array.from(new Set(
    rawTokens.map(c => c.toLowerCase()).filter(c => /\d/.test(c) || c.includes('_'))
  ));

  if (specificCodes.length > 0) {
    try {
      const chunksCollection = collection(db, 'knowledge_chunks');
      let snapshot;
      if (sourceFiles && sourceFiles.length > 0) {
        const maxBatchSize = 10;
        const allDocs: any[] = [];
        for (let i = 0; i < sourceFiles.length; i += maxBatchSize) {
          const batchFiles = sourceFiles.slice(i, i + maxBatchSize);
          const snap = ownerId
            ? await getDocs(query(chunksCollection, where('ownerId', '==', ownerId), where('sourceFileId', 'in', batchFiles)))
            : await getDocs(query(chunksCollection, where('sourceFileId', 'in', batchFiles)));
          snap.docs.forEach(d => allDocs.push(d));
        }
        snapshot = { docs: allDocs };
      } else {
        snapshot = ownerId
          ? await getDocs(query(chunksCollection, where('ownerId', '==', ownerId)))
          : await getDocs(query(chunksCollection));
      }

      snapshot.docs.forEach((doc: any) => {
        const data = doc.data();
        const textLower = (data.text || '').toLowerCase();
        const hasCodeMatch = specificCodes.some(code => textLower.includes(code));
        if (hasCodeMatch) {
          const alreadyExists = filteredResults.some(r => r.chunk.id === doc.id);
          if (!alreadyExists) {
            filteredResults.unshift({
              chunk: {
                id: doc.id,
                sourceFile: data.sourceFile || 'Unknown File',
                text: data.text || '',
                embedding: data.embedding || [],
                createdAt: data.createdAt
              },
              score: 0.99
            });
          }
        }
      });
    } catch (codeErr) {
      console.warn("Direct code search rescue failed:", codeErr);
    }
  }

  // High-value fallback: If no high-quality vector results were found, perform smart keyword matching over user's files chunks
  if (filteredResults.length === 0) {
    console.log("[SmartHub RAG] No high-scoring vector matches. Initiating smart word-matching keyword search fallback...");
    try {
      const chunksCollection = collection(db, 'knowledge_chunks');
      let snapshot;
      if (sourceFiles && sourceFiles.length > 0) {
        // Fetch chunks of source files
        const maxBatchSize = 10;
        const batches = [];
        for (let i = 0; i < sourceFiles.length; i += maxBatchSize) {
          batches.push(sourceFiles.slice(i, i + maxBatchSize));
        }
        const allDocs: any[] = [];
        for (const batch of batches) {
          snapshot = ownerId
            ? await getDocs(query(chunksCollection, where('ownerId', '==', ownerId), where('sourceFileId', 'in', batch)))
            : await getDocs(query(chunksCollection, where('sourceFileId', 'in', batch)));
          snapshot.docs.forEach(d => allDocs.push(d));
        }
        snapshot = { docs: allDocs };
      } else {
        snapshot = ownerId
          ? await getDocs(query(chunksCollection, where('ownerId', '==', ownerId)))
          : await getDocs(query(chunksCollection));
      }

      // Convert user question to split keywords
      const queryWords = userQuestion.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 1);

      if (queryWords.length > 0) {
        const matched: { chunk: any; score: number }[] = [];
        snapshot.docs.forEach((doc: any) => {
          const data = doc.data();
          const chunkTextLower = (data.text || '').toLowerCase();
          let matchCount = 0;
          queryWords.forEach(word => {
            if (chunkTextLower.includes(word)) {
              matchCount++;
            }
          });

          if (matchCount > 0) {
            // Assign a proportional score from 0.40 to 0.90 based on matched keyword density
            const keywordRatio = matchCount / queryWords.length;
            const score = 0.40 + keywordRatio * 0.50;
            matched.push({
              chunk: {
                id: doc.id,
                sourceFile: data.sourceFile || 'Unknown File',
                text: data.text || '',
                embedding: data.embedding || [],
                createdAt: data.createdAt
              },
              score
            });
          }
        });

        // Sort by match quality descending
        matched.sort((a, b) => b.score - a.score);
        filteredResults = matched.slice(0, 5);
        if (filteredResults.length > 0) {
          console.log(`[SmartHub RAG Keyword Matcher] Successfully rescued ${filteredResults.length} chunks via text-match fallback!`);
        }
      }
    } catch (kwError) {
      console.warn("Keyword fallback rescue search failed:", kwError);
    }
  }
  
  if (filteredResults.length === 0 && !liveSummaries) {
    // If no context matched, converse nicely with the user but remind them about document bounds
    const systemInstruction = `Bạn là AI Sales Intelligence Assistant. Người dùng đã lựa chọn tài liệu nhưng không tìm thấy dữ liệu trùng khớp cao nào trong Context liên quan đến câu hỏi: "${userQuestion}".
Hãy trả lời một cách lịch sự bằng tiếng Việt, giải thích khách quan những gì bạn hiểu từ câu hỏi của họ, hoặc trả lời dựa vào kiến thức chung của bạn. Gợi ý họ đặt câu hỏi trực tiếp hơn vào dữ liệu sản phẩm, doanh số, khu vực có trong tệp, hoặc kiểm tra xem dữ liệu trong tệp có chứa thông tin đó không.`;
    
    try {
      const chatResponse = await chatWithAI(userQuestion, history, systemInstruction);
      return {
        answer: chatResponse.text,
        citations: [],
        usedCitations: []
      };
    } catch (err) {
      return {
        answer: "Tôi đã tìm kiếm trong các nguồn tài liệu của bạn nhưng không thấy thông tin phù hợp, và việc kết nối dịch vụ trò chuyện tạm thời bị gián đoạn. Bạn vui lòng thử lại nhé!",
        citations: [],
        usedCitations: []
      };
    }
  }
  
  // 4. Extract text to build prompt Context and dynamically replace old "[Mục X]" with "[Dòng Excel X]"
  const retrievedChunksText = filteredResults
    .map((r, i) => {
      let chunkText = r.chunk.text;
      // Convert older "[Mục X]" to "[Dòng Excel X + 1]" (assuming old data starts at Row 2, so index 1 in old is Excel row 2)
      chunkText = chunkText.replace(/\[Mục\s+(\d+)\]/gi, (match, p1) => {
        const itemIndex = parseInt(p1, 10);
        return `[Dòng Excel ${itemIndex + 1}]`;
      });
      return `[Tập tài liệu: ${r.chunk.sourceFile} - Độ tương đồng: ${(r.score * 100).toFixed(1)}%]\n${chunkText}`;
    })
    .join("\n\n");

  const retrievedContext = (liveSummaries ? liveSummaries.trim() + "\n\n" : "") + 
    (directMatchedRowsText ? directMatchedRowsText + "\n\n" : "") + 
    retrievedChunksText;
    
  const systemInstruction = `You are an AI Data Assistant and Expert Analyst (AI Sales Intelligence Assistant chuyên nghiệp).
Your task is to answer user queries strictly based on the provided Context.

### CORE PRINCIPLES (NGUYÊN TẮC CỐT LÕI):
1. **Faithfulness (Trung thực tuyệt đối):** Every fact, number, and conclusion in your answer must be directly supported by the Context. Do not extrapolate, assume, or bring in external knowledge. If the answer cannot be found in the Context, state clearly: "Dữ liệu được cung cấp không đủ để trả lời câu hỏi này."
2. **Strict Calculation & Full Disclosure (Tính toán & Trích xuất toàn diện):** Extract exact values, show step-by-step formulas, and detail every single result with complete transparency down to exact Excel row numbers and column names.

### MANDATORY RESPONSE STRUCTURE FOR ALL QUERIES (CẤU TRÚC PHẢN HỒI BẮT BUỘC DÀNH CHO TOÀN BỘ CÂU HỎI):
Mọi câu trả lời của bạn BẮT BUỘC phải tuân theo cấu trúc 4 phần cực kỳ chi tiết, mạch lạc và chuyên nghiệp như sau:

1. **Lời Mở Đầu & Xác Nhận Trực Tiếp (Direct Answer & Confirmation):**
   - Lời chào lịch sự, xác nhận thông tin trả lời trực tiếp cho câu hỏi của người dùng.
   - Nêu rõ đối tượng/đơn hàng/mã sản phẩm/chỉ số được tìm thấy nguyên vẹn tại **Dòng Excel X** (hoặc phạm vi từ **Dòng Excel A** đến **Dòng Excel B**) trong tệp dữ liệu nguồn (ví dụ: **DATA.xlsx**).

2. **Thông Tin Chi Tiết Trích Xuất (Detailed Extracted Information):**
   - Trình bày dạng danh sách gạch đầu dòng rõ ràng tất cả các trường dữ liệu thực tế:
     + Mã đơn hàng: ...
     + Nhân viên phụ trách / Nhân viên bán hàng: ...
     + Khu vực giao dịch / Khu vực: ...
     + Hình thức thanh toán: ...
     + Trạng thái khách hàng: ...
     + Sản phẩm / Danh mục: ...
     + Số lượng / Doanh thu / Lợi nhuận / Ngày bán...
   - Nếu câu hỏi liên quan đến tổng hợp / tính toán: Liệt kê các số liệu trích xuất (Data extracted), Công thức áp dụng (Formula/Logic) và Chi tiết từng bước tính toán (Step-by-step).

3. **BẢNG TRÍCH NGUỒN DỮ LIỆU (Source Reference Citation Table):**
   BẮT BUỘC phải tạo Bảng trích dẫn nguồn bằng Markdown có tiêu đề chính xác **BẢNG TRÍCH NGUỒN DỮ LIỆU** với đúng 6 cột:
   | STT | TỆP DỮ LIỆU NGUỒN | DÒNG EXCEL | CỘT DỮ LIỆU | GIÁ TRỊ THỰC TẾ | CĂN CỨ / GIẢI THÍCH |
   |-----|-------------------|------------|-------------|------------------|---------------------|
   - Điền đầy đủ từng trường thông tin trích xuất (Ví dụ:
     | 1 | DATA.xlsx | Dòng Excel 4059 | Tên nhân viên | Đỗ Mạnh Hùng | Trích xuất trực tiếp từ cột "Tên nhân viên" tại dòng 4059. |
     | 2 | DATA.xlsx | Dòng Excel 4059 | Khu vực | Miền Trung | Trích xuất trực tiếp từ cột "Khu vực" tại dòng 4059. |
     | 3 | DATA.xlsx | Dòng Excel 4059 | Hình thức thanh toán | Ví điện tử | Trích xuất trực tiếp từ cột "Hình thức thanh toán" tại dòng 4059. |
     ...).
   - Tuyệt đối KHÔNG bỏ qua bảng này trong bất kỳ câu trả lời nào. Nếu là câu hỏi tổng hợp, liệt kê từng cột dữ liệu tính toán kèm phạm vi Dòng Excel và căn cứ công thức cộng dồn SUM.

4. **Thông Tin Bổ Sung & Kết Luận (Supplementary Details & Conclusion):**
   - Trình bày các thông tin bổ sung liên quan (Ví dụ: Sản phẩm, Mã SP, Danh mục, Số lượng, Doanh thu, Lợi nhuận, Ngày bán...).
   - Khẳng định: "Tất cả các thông tin trên đều được xác định trực tiếp từ bản ghi dữ liệu chi tiết của tệp DATA.xlsx." (hoặc tệp dữ liệu nguồn tương ứng).

YÊU CẦU QUAN TRỌNG VỀ QUY TẮC DÒNG/CỘT EXCEL:
1. TUYỆT ĐỐI CẤM dùng từ "Mục" hay "Mục X". BẮT BUỘC gọi chính xác là "Dòng Excel X" (ví dụ: "Dòng Excel 4059").
2. Chỉ trích dẫn tên Cột thực tế có trong file Excel (Cột "Tên nhân viên", Cột "Khu vực", Cột "Doanh thu", Cột "Lợi nhuận", Cột "Sản phẩm", Cột "Số lượng", Cột "Hình thức thanh toán", Cột "Trạng thái khách hàng"...).
3. Đảm bảo sử dụng định dạng Markdown phong phú (in đậm, danh sách gạch đầu dòng, bảng Markdown) giúp câu trả lời minh bạch, đẹp mắt và trực quan nhất.

Context:
${retrievedContext}`;

  try {
    const chatResponse = await chatWithAI(userQuestion, history, systemInstruction);
    const uniqueSources = Array.from(new Set(filteredResults.map(r => r.chunk.sourceFile)));
    
    return {
      answer: chatResponse.text,
      citations: filteredResults.map(r => ({
        fileName: r.chunk.sourceFile,
        text: r.chunk.text,
        score: r.score
      })),
      usedCitations: uniqueSources,
      queryVector: queryVector,
      systemInstruction: systemInstruction,
      retrievedContext: retrievedContext
    };
  } catch (error) {
    console.error("Chat generation failed:", error);
    return {
      answer: "Đã xảy ra lỗi khi tạo phản hồi từ mô hình AI. Xin vui lòng thử lại sau.",
      citations: [],
      usedCitations: []
    };
  }
}
