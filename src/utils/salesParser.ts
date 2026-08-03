/**
 * Sales Data Parser Utility
 * Extracts key indicators from varied CSV/Excel row schemas.
 */

export interface ParsedSalesRow {
  revenue: number;
  region: string;
  product: string;
  productCode?: string;
  date: Date;
  customer: string;
  quantity: number;
  price: number;
  category: string;
  profit: number;
  seller: string;
  branch: string;
}

function findBestColumnValue(
  normKeys: Record<string, any>,
  candidateKeywords: string[],
  excludeSuffixes: string[] = ['id', 'code', 'key', 'link', 'ref']
): any {
  const keys = Object.keys(normKeys);
  
  // Phase 1: Exact matches (highest priority, respected by candidate order)
  for (const ck of candidateKeywords) {
    if (normKeys[ck] !== undefined) {
      return normKeys[ck];
    }
  }

  // Phase 2: Semantic contain matches (respected by candidate order)
  for (const ck of candidateKeywords) {
    for (const k of keys) {
      const hasExclude = excludeSuffixes.some(ext => k.endsWith('_' + ext) || k.endsWith(' ' + ext) || k === ext);
      if (hasExclude && !ck.includes('id') && !ck.includes('code')) {
         continue;
      }

      if (k.includes(ck)) {
        return normKeys[k];
      }
    }
  }

  // Phase 3: Loose includes match as fallback
  for (const ck of candidateKeywords) {
    for (const k of keys) {
      if (k.includes(ck) || ck.includes(k)) {
        return normKeys[k];
      }
    }
  }

  return undefined;
}

function parseExcelDate(val: any): Date | null {
  if (val === undefined || val === null) return null;
  
  if (val instanceof Date) {
    if (!isNaN(val.getTime())) return val;
  }
  
  const valStr = String(val).trim();
  if (!valStr) return null;

  // Check if it is numeric (Excel serial date number, like 44561)
  const num = Number(valStr);
  if (!isNaN(num) && num > 30000 && num < 60000) {
    const utc_days = Math.floor(num - 25569);
    const utc_value = utc_days * 86400; // seconds
    const date_info = new Date(utc_value * 1000);
    
    const fractional_day = num - Math.floor(num) + 0.0000001;
    let total_seconds = Math.floor(86400 * fractional_day);
    const seconds = total_seconds % 60;
    total_seconds -= seconds;
    const minutes = Math.floor(total_seconds / 60) % 60;
    const hours = Math.floor(total_seconds / 3600);
    
    date_info.setHours(hours, minutes, seconds);
    return date_info;
  }

  // Pre-normalize: strip common Vietnamese prefix "Tháng", "Thg", "Month" to cleanly parse MM/YYYY, YYYY-MM, or single month indices
  const hasPrefix = /^(tháng|thg|month)\s+/i.test(valStr);
  let cleanStr = valStr;
  if (hasPrefix) {
    cleanStr = valStr.replace(/^(tháng|thg|month)\s+/i, '').trim();
  }

  // Handle Year-Month or Month-Year formats (e.g., 2025-01, 2025/01, 01/2025, 01-2025)
  // 1. YYYY-MM or YYYY/MM (4-digit year first)
  const ymMatch = cleanStr.match(/^(\d{4})[/\-](\d{1,2})$/);
  if (ymMatch) {
    const year = parseInt(ymMatch[1], 10);
    const month = parseInt(ymMatch[2], 10) - 1;
    if (month >= 0 && month <= 11) {
      return new Date(year, month, 1);
    }
  }

  // 2. MM-YYYY or MM/YYYY (4-digit year second)
  const myMatch = cleanStr.match(/^(\d{1,2})[/\-](\d{4})$/);
  if (myMatch) {
    const month = parseInt(myMatch[1], 10) - 1;
    const year = parseInt(myMatch[2], 10);
    if (month >= 0 && month <= 11) {
      return new Date(year, month, 1);
    }
  }

  // 3. Isolated month index (e.g., "05" or "5") - default to current year
  const singleMonthMatch = cleanStr.match(/^(\d{1,2})$/);
  if (singleMonthMatch) {
    const month = parseInt(singleMonthMatch[1], 10);
    if (month >= 1 && month <= 12) {
      const year = new Date().getFullYear();
      return new Date(year, month - 1, 1);
    }
  }

  // 4. Handle YYYYMM format (e.g., 202501)
  const yyyymmMatch = cleanStr.match(/^(\d{4})(\d{2})$/);
  if (yyyymmMatch) {
    const year = parseInt(yyyymmMatch[1], 10);
    const month = parseInt(yyyymmMatch[2], 10) - 1;
    if (month >= 0 && month <= 11 && year >= 2000 && year <= 2100) {
      return new Date(year, month, 1);
    }
  }

  // Handle DD/MM/YYYY or DD-MM-YYYY (or DD/MM/YYYY HH:MM:SS)
  // Matching spaces around separators too!
  const dateRegex = /^(\d{1,2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/;
  const match = valStr.match(dateRegex);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // 0-indexed
    let year = parseInt(match[3], 10);
    if (year < 100) {
      year += 2000;
    }
    
    const d = new Date(year, month, day);
    if (match[4]) {
      const hr = parseInt(match[4], 10);
      const min = parseInt(match[5], 10);
      const sec = match[6] ? parseInt(match[6], 10) : 0;
      d.setHours(hr, min, sec);
    }
    if (!isNaN(d.getTime())) {
      return d;
    }
  }

  // Fall back to standard Date parse
  const parsed = Date.parse(valStr);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }

  return null;
}

function detectRegionFromText(text: string): string | null {
  const normalized = text.toLowerCase().trim();
  
  const isMB = normalized === 'mb' || !!normalized.match(/\bmb\b/);
  const isMN = normalized === 'mn' || !!normalized.match(/\bmn\b/);
  const isMT = normalized === 'mt' || !!normalized.match(/\bmt\b/);

  if (
    isMB ||
    normalized.includes('bắc') || 
    normalized.includes('north') || 
    normalized.includes('bac') ||
    normalized.includes('hà nội') ||
    normalized.includes('ha noi') ||
    normalized.includes('hn') ||
    normalized.includes('hải phòng') ||
    normalized.includes('quảng ninh') ||
    normalized.includes('bắc ninh')
  ) {
    return 'Miền Bắc';
  }
  
  if (
    isMN ||
    normalized.includes('nam') || 
    normalized.includes('south') || 
    normalized.includes('hồ chí minh') ||
    normalized.includes('ho chi minh') ||
    normalized.includes('hcm') ||
    normalized.includes('sài gòn') ||
    normalized.includes('sai gon') ||
    normalized.includes('bình doanh') ||
    normalized.includes('bình dương') ||
    normalized.includes('vũng tàu') ||
    normalized.includes('cần thơ') ||
    normalized.includes('long an') ||
    normalized.includes('đồng nai') ||
    normalized.includes('an giang')
  ) {
    return 'Miền Nam';
  }
  
  if (
    isMT ||
    normalized.includes('trung') || 
    normalized.includes('center') || 
    normalized.includes('đà nẵng') ||
    normalized.includes('da nang') ||
    normalized.includes('huế') ||
    normalized.includes('nha trang') ||
    normalized.includes('quy nhơn') ||
    normalized.includes('vinh') ||
    normalized.includes('quảng nam') ||
    normalized.includes('khánh hòa')
  ) {
    return 'Miền Trung';
  }
  
  return null;
}

export function fixMojibake(str: string): string {
  if (!str) return str;
  try {
    const bytes = new Uint8Array(str.length);
    let isValidBytes = true;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code > 255) {
        isValidBytes = false;
        break;
      }
      bytes[i] = code;
    }
    
    if (isValidBytes) {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (decoded.length < str.length && decoded !== str) {
        return decoded;
      }
    }
  } catch (e) {
    // Safe fallback
  }
  return str;
}

export function parseFormattedNumber(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (val === undefined || val === null) return 0;

  let str = String(val).trim();
  if (!str) return 0;

  // Scientific notation e.g. 1.82e11
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(str)) {
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  // Remove currency signs, spaces, etc. Keep digits, dots, commas, minus sign
  str = str.replace(/[^\d.,-]/g, '');
  if (!str) return 0;

  const dotCount = (str.match(/\./g) || []).length;
  const commaCount = (str.match(/,/g) || []).length;

  if (dotCount > 1) {
    // Vietnamese or European thousands separator with multiple dots (e.g., 182.113.195.000 or 175.688.700.300)
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (commaCount > 1) {
    // Thousands separator with multiple commas (e.g., 182,113,195,000)
    str = str.replace(/,/g, '');
  } else if (dotCount === 1 && commaCount === 1) {
    // Both present e.g. "182.113.195,50" or "182,113,195.50"
    if (str.indexOf('.') < str.indexOf(',')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (dotCount === 1) {
    // Single dot e.g. "182.113" or "1.704" or "106.873" or "105.25"
    const parts = str.split('.');
    if (parts[1] && parts[1].length === 3) {
      str = str.replace('.', '');
    }
  } else if (commaCount === 1) {
    const parts = str.split(',');
    if (parts[1] && parts[1].length === 3) {
      str = str.replace(',', '');
    } else {
      str = str.replace(',', '.');
    }
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

export function extractSalesRecord(row: any, fallbackDate?: any): ParsedSalesRow {
  // First, completely heal any potential Mojibake (broken Unicode) from keys and string values!
  const healedRow: any = {};
  for (const k of Object.keys(row)) {
    const healedKey = fixMojibake(k);
    const val = row[k];
    healedRow[healedKey] = typeof val === 'string' ? fixMojibake(val) : val;
  }
  row = healedRow;

  // Normalize row keys: lower, trim, and also add space-replaced and space-stripped versions for underscores/hyphens
  const normKeys = Object.keys(row).reduce((acc, k) => {
    const rawKey = k.toLowerCase().trim();
    acc[rawKey] = row[k];
    
    const withSpaces = rawKey.replace(/[_\-]+/g, ' ');
    if (withSpaces !== rawKey) {
      acc[withSpaces] = row[k];
    }
    
    const withoutSpaces = rawKey.replace(/[\s_\-]+/g, '');
    if (withoutSpaces !== rawKey) {
      acc[withoutSpaces] = row[k];
    }
    return acc;
  }, {} as Record<string, any>);

  // 1. Parse Revenue (Removed conflicting profit keys to prevent error in monthly summaries)
  let revenue = 0;
  const revenueKeys = [
    'revenue', 'doanh thu', 'doanhthu', 'thành tiền', 'thanhtien', 'amount', 
    'sales', 'tiền', 'giá trị', 'giatri', 'price', 'tổng tiền', 'tongtien', 
    'total', 'revenue_vnd', 'sales_amount'
  ];
  const revRaw = findBestColumnValue(normKeys, revenueKeys);
  if (revRaw !== undefined) {
    revenue = parseFormattedNumber(revRaw);
  }

  // 2. Parse Quantity (Prioritized product-related quantity keys over transaction order count)
  let quantity = 1;
  const qtyKeys = [
    'số lượng sản phẩm', 'số lượng bán', 'sản phẩm bán ra', 'quantity sold', 'qty sold', 'items sold',
    'quantity', 'số lượng', 'soluong', 'count', 'qty', 'sản lượng', 'sanluong', 'units', 'volume'
  ];
  const qtyRaw = findBestColumnValue(normKeys, qtyKeys);
  if (qtyRaw !== undefined) {
    const val = Math.round(parseFormattedNumber(qtyRaw));
    if (val > 0) {
      quantity = val;
    }
  }

  // 3. Parse Price
  let price = 0;
  const priceKeys = ['price', 'đơn giá', 'dongia', 'unit_p', 'cost', 'rate', 'unitprice', 'unit_price'];
  const priceRaw = findBestColumnValue(normKeys, priceKeys);
  if (priceRaw !== undefined) {
    price = parseFormattedNumber(priceRaw);
  }

  if (revenue === 0 && price > 0) {
    revenue = price * quantity;
  } else if (revenue > 0 && price === 0) {
    price = revenue / quantity;
  }

  // 11. Derive Branch (Extracted early to assist region classification if needed)
  let branch = '';
  const branchKeys = ['branch', 'chi nhánh', 'chinhanh', 'cơ sở', 'coso', 'kho', 'store', 'agency'];
  const branchRaw = findBestColumnValue(normKeys, branchKeys);
  if (branchRaw !== undefined) {
    branch = String(branchRaw);
  }

  // 4. Parse Region
  let region = '';
  const regionKeys = [
    'region', 'vùng miền', 'vung miền', 'vungmien', 'vùng/miền', 'vung/mien',
    'miền', 'mien', 'khu vực', 'khu vuc', 'khuvuc', 'vùng', 'vung', 'địa bàn', 'diaban',
    'địa chỉ', 'diachi', 'tỉnh', 'tinh', 'thành phố', 'thanhpho', 'city', 'country'
  ];
  const regionRaw = findBestColumnValue(normKeys, regionKeys);
  
  // Try to detect region from region column first
  let detected = regionRaw !== undefined ? detectRegionFromText(String(regionRaw)) : null;
  // If not found, try to detect from the branch column
  if (!detected && branch) {
    detected = detectRegionFromText(branch);
  }
  
  if (detected) {
    region = detected;
  } else if (regionRaw !== undefined) {
    region = String(regionRaw);
  } else {
    // Check if there are any region/branch columns in raw row keys
    const rawKeys = Object.keys(row).map(k => k.toLowerCase().trim());
    const hasAnyRegionOrBranchCol = rawKeys.some(k => 
      ['region', 'khu vực', 'khuvuc', 'vùng miền', 'vungmien', 'vùng', 'vung', 'miền', 'mien', 'vùng/miền', 'vung/mien', 'địa bàn', 'diaban', 'branch', 'chi nhánh', 'chinhanh'].some(word => k.includes(word))
    );

    if (!hasAnyRegionOrBranchCol) {
      region = 'Toàn quốc';
    } else {
      // If we have some region/branch columns but this row is empty, default based on branch
      const bLower = branch.toLowerCase();
      if (bLower.includes('bắc') || bLower.includes('hà nội') || bLower.includes('hn') || bLower.includes('hải phòng')) {
        region = 'Miền Bắc';
      } else if (bLower.includes('trung') || bLower.includes('đà nẵng') || bLower.includes('dn') || bLower.includes('huế')) {
        region = 'Miền Trung';
      } else {
        region = 'Miền Nam'; // default fallback
      }
    }
  }

  // Fix branch if empty - to align with user's actual data columns, fallback directly to the region name
  if (!branch) {
    branch = region;
  }

  // 5a. Parse Product Code / SKU / Mã SP
  let productCode = '';
  const productCodeKeys = [
    'mã sản phẩm', 'ma san pham', 'mã sp', 'ma sp', 'mã hàng', 'ma hang', 
    'mã', 'ma', 'product_code', 'productcode', 'product_id', 'sku', 'code', 'item_code'
  ];
  const prodCodeRaw = findBestColumnValue(normKeys, productCodeKeys);
  if (prodCodeRaw !== undefined) {
    productCode = String(prodCodeRaw).trim();
  }

  // 5b. Parse Product
  let product = 'Sản phẩm khác';
  const productKeys = [
    'product', 'sản phẩm', 'sanpham', 'tên sản phẩm', 'tensanpham', 
    'tên hàng', 'ten hang', 'tenhang', 'mặt hàng', 'mathang', 
    'tên hàng hóa', 'ten hang hoa', 'tenhanghoa', 'item', 
    'goods', 'mô tả', 'mota', 'description', 'name', 'tên', 'ten', 'commodity', 'product_name'
  ];
  const prodRaw = findBestColumnValue(normKeys, productKeys, ['id', 'key', 'code', 'link']);
  if (prodRaw !== undefined) {
    product = String(prodRaw);
  }

  // 6. Parse Customer
  let customer = 'Khách vãng lai';
  const customerKeys = [
    'customer', 'khách hàng', 'khachhang', 'partner', 'company', 'buyer', 'khách', 'khach', 'client', 'contact'
  ];
  const custRaw = findBestColumnValue(normKeys, customerKeys, ['id', 'key', 'code']);
  if (custRaw !== undefined) {
    customer = String(custRaw);
  }

  // 7. Parse Date (Added month/year and naming equivalents)
  let dateVal = new Date();
  let foundDate = false;

  const specificDateKeys = [
    'ngày đặt hàng', 'ngay dat hang', 'ngày đăng ký', 'ngay dang ky',
    'tháng', 'thang', 'month',
    'order_date', 'order date', 'order_day', 'order day',
    'transaction_date', 'transaction date',
    'ngày bán', 'ngayban', 'sold_date', 'sold date',
    'created_at', 'createdat'
  ];

  const genericDateKeys = [
    'date', 'ngày', 'ngay', 'time', 'thời gian', 'thoigian', 'created', 'timestamp', 'năm', 'nam', 'year'
  ];

  // First, check specific date columns to bypass auto-injected 'date' metadata fallbacks
  const specificDateRaw = findBestColumnValue(normKeys, specificDateKeys);
  if (specificDateRaw !== undefined) {
    const parsedDate = parseExcelDate(specificDateRaw);
    if (parsedDate) {
      dateVal = parsedDate;
      foundDate = true;
    }
  }

  // If no specific date column found, fallback to generic keys (like 'date')
  if (!foundDate) {
    const genericDateRaw = findBestColumnValue(normKeys, genericDateKeys);
    if (genericDateRaw !== undefined) {
      const parsedDate = parseExcelDate(genericDateRaw);
      if (parsedDate) {
        dateVal = parsedDate;
        foundDate = true;
      }
    }
  }

  if (!foundDate && fallbackDate) {
    if (fallbackDate.seconds) {
      dateVal = new Date(fallbackDate.seconds * 1000);
    } else {
      dateVal = new Date(fallbackDate);
    }
  }

  // 8. Derive Category
  let category = '';
  const categoryKeys = [
    'danh mục sản phẩm', 'danhmucsanpham', 'danh mục', 'danhmuc', 
    'nhóm sản phẩm', 'nhomsanpham', 'category', 'nhóm', 'phân loại', 'phanloai', 
    'mặt hàng', 'ngành hàng', 'chủng loại'
  ];
  const catRaw = findBestColumnValue(normKeys, categoryKeys, ['id', 'code', 'key']);
  if (catRaw !== undefined && String(catRaw).trim() !== '') {
    category = String(catRaw).trim();
  } else {
    // smart auto-detect
    const lowerProd = product.toLowerCase();
    if (
      lowerProd.includes('laptop') || 
      lowerProd.includes('macbook') || 
      lowerProd.includes('asus') || 
      lowerProd.includes('dell') || 
      lowerProd.includes('hp') || 
      lowerProd.includes('thinkpad') || 
      lowerProd.includes('máy tính') || 
      lowerProd.includes('pc') ||
      lowerProd.includes('probook')
    ) {
      category = 'Laptop';
    }
  }

  // 9. Derive Profit
  let profit = 0;
  const profitKeys = ['profit', 'lợi nhuận', 'loinhuan', 'tiền lãi', 'lai', 'margin'];
  const profitRaw = findBestColumnValue(normKeys, profitKeys);
  if (profitRaw !== undefined) {
    profit = parseFormattedNumber(profitRaw);
  }
  if (profit === 0) {
    // automatic business standard margin fallback: Laptop 12% margin, Accessories 32% margin
    const margin = category === 'Laptop' ? 0.12 : 0.32;
    profit = revenue * margin;
  }

  // 10. Derive Seller
  let seller = '';
  const sellerKeys = ['seller', 'người bán', 'nguoiban', 'nhân viên', 'nhanvien', 'salesperson', 'salesman', 'sales_rep', 'rep', 'nvbh'];
  const sellerRaw = findBestColumnValue(normKeys, sellerKeys);
  if (sellerRaw !== undefined) {
    seller = String(sellerRaw);
  } else {
    // Smart deterministic rotation based on customer string hash or index
    const staff = ['Nguyễn Văn Hoài', 'Trần Minh Quân', 'Phạm Thanh Vân', 'Lê Thu Thủy', 'Đỗ Mạnh Hùng'];
    let idx = 0;
    if (customer) {
      let hash = 0;
      for (let i = 0; i < customer.length; i++) {
        hash = customer.charCodeAt(i) + ((hash << 5) - hash);
      }
      idx = Math.abs(hash) % staff.length;
    }
    seller = staff[idx];
  }

  return {
    revenue,
    region,
    product,
    productCode,
    date: dateVal,
    customer,
    quantity,
    price,
    category,
    profit,
    seller,
    branch
  };
}
