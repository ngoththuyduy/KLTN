import { SalesFile } from '@/types';
import { doc, setDoc, writeBatch } from 'firebase/firestore';

const STORAGE_KEY = 'sales_intel_uploaded_files';
const RECORDS_PREFIX = 'sales_intel_records_';

function getActiveDemoId(): string | null {
  try {
    const activeUser = JSON.parse(sessionStorage.getItem('sales_intel_active_demo_user') || 'null');
    if (activeUser?.id && String(activeUser.id).startsWith('demo_')) {
      return activeUser.id;
    }
  } catch {
    return null;
  }
  return null;
}

function scopedKey(key: string): string {
  const demoId = getActiveDemoId();
  if (demoId) {
    return `${key}_${demoId}`;
  }
  return key;
}

function scopedStorage(): Storage {
  if (getActiveDemoId()) {
    return sessionStorage;
  }
  return localStorage;
}

function scopedRecordsKey(fileId: string): string {
  return scopedKey(`${RECORDS_PREFIX}${fileId}`);
}

export function sanitizeForFirestore(val: any): any {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val)) return 0;
    return val;
  }
  if (typeof val === 'string' || typeof val === 'boolean') {
    return val;
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeForFirestore);
  }
  if (typeof val === 'object' && val !== null) {
    const clean: Record<string, any> = {};
    for (const k of Object.keys(val)) {
      const v = val[k];
      if (typeof v === 'function' || typeof v === 'symbol' || v === undefined) {
        continue;
      }
      const cleanKey = k.replace(/\./g, '_').trim();
      if (cleanKey.length > 0) {
        clean[cleanKey] = sanitizeForFirestore(v);
      }
    }
    return clean;
  }
  return null;
}

function generate5000SampleRecords(): any[] {
  const regions = ["Hà Nội", "TP.HCM", "Đà Nẵng", "Cần Thơ", "Hải Phòng", "Nha Trang", "Bình Dương", "Đồng Nai"];
  const sellers = ["Phạm Văn Nam", "Trần Thị Mai", "Lê Văn Hùng", "Nguyễn Thị Vân", "Đỗ Hoàng Long", "Phạm Anh Khoa"];
  const items = [
    { name: "Laptop Dell XPS 15", brand: "Dell", price: 35000000 },
    { name: "Màn hình LG UltraWide 34 inch", brand: "LG", price: 12500000 },
    { name: "Bàn phím cơ Keychron Q1", brand: "Keychron", price: 4200000 },
    { name: "Tai nghe Sony WH-1000XM5", brand: "Sony", price: 8900000 },
    { name: "Chuột Logitech MX Master 3S", brand: "Logitech", price: 2500000 },
    { name: "MacBook Pro 14 M3", brand: "Apple", price: 48000000 },
    { name: "Màn hình Dell UltraSharp U2723QE", brand: "Dell", price: 14500000 },
    { name: "Ổ cứng SSD Samsung 990 Pro 2TB", brand: "Samsung", price: 4500000 },
    { name: "Webcam Logitech Brio 4K", brand: "Logitech", price: 4800000 },
    { name: "Loa Bluetooth JBL Charge 5", brand: "JBL", price: 3600000 },
    { name: "Laptop Lenovo ThinkPad X1 Carbon", brand: "Lenovo", price: 42000000 },
    { name: "Bàn di chuột Corsair MM300", brand: "Corsair", price: 600000 },
    { name: "Sạc Anker Nano 30W", brand: "Anker", price: 450000 },
    { name: "Apple Watch Series 9", brand: "Apple", price: 10500000 },
    { name: "AirPods Pro 2", brand: "Apple", price: 5500000 }
  ];
  const customers = [
    "Nguyễn Văn A", "Công ty B", "Nguyễn Thị C", "Trần Văn D", "Công ty E", 
    "Lê Thị F", "Phạm Văn G", "Hoàng Thị H", "Đỗ Văn I", "Vũ Thị K", 
    "Đặng Văn L", "Bùi Thị M", "Công ty Minh Hoàng", "Tập đoàn VinaTech", "Doanh nghiệp Hưng Thịnh"
  ];
  const statuses = ["Hoàn thành", "Đã thanh toán", "Đang giao"];

  const rows = [];
  const startDate = new Date(2025, 0, 1).getTime();
  const endDate = new Date(2026, 5, 30).getTime();

  for (let i = 1; i <= 5000; i++) {
    const item = items[(i - 1) % items.length];
    const qty = ((i * 7) % 10) + 1;
    const rev = qty * item.price;
    const profit = Math.round(rev * (0.15 + ((i % 15) / 100)));
    const dateObj = new Date(startDate + ((i / 5000) * (endDate - startDate)));
    const dateStr = dateObj.toISOString().split('T')[0];
    const orderId = `HD${String(i).padStart(5, '0')}`;

    rows.push({
      "Mã Đơn": orderId,
      "Ngày Mua": dateStr,
      "Tên Khách Hàng": customers[i % customers.length],
      "Khu Vực": regions[i % regions.length],
      "Mặt Hàng": item.name,
      "Thương Hiệu": item.brand,
      "Số Lượng": qty,
      "Đơn Giá": item.price,
      "Doanh Thu": rev,
      "Lợi Nhuận": profit,
      "Trạng Thái": statuses[i % statuses.length],
      "Nhân Viên Sale": sellers[i % sellers.length]
    });
  }
  return rows;
}

export const SAMPLE_5000_RECORDS = generate5000SampleRecords();

export const DEFAULT_STANDARD_FILE: SalesFile = {
  id: 'standard_default_sample_file',
  fileName: 'Dữ liệu phân tích bán hàng tiêu chuẩn 5000 bản ghi.xlsx',
  metadata: 'Sheet: Bán hàng 2025-2026',
  uploadDate: '2026-06-24T08:30:00.000Z',
  uploadedBy: 'Thủy Duy Ngô (System Admin)',
  recordCount: 5000,
  status: 'COMPLETED',
  embeddingStatus: 'READY',
  sampleRows: SAMPLE_5000_RECORDS.slice(0, 50)
};

const DELETED_FILES_KEY = 'sales_intel_deleted_file_ids';
export const DEFAULT_SAMPLE_IDS = ['standard_default_sample_file', 'default_sales_sample'];

export function getDeletedFileIds(): string[] {
  try {
    const raw = scopedStorage().getItem(scopedKey(DELETED_FILES_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function markFileAsDeleted(fileId: string): void {
  try {
    const deleted = getDeletedFileIds();
    if (!deleted.includes(fileId)) {
      deleted.push(fileId);
      scopedStorage().setItem(scopedKey(DELETED_FILES_KEY), JSON.stringify(deleted));
    }
  } catch (err) {
    console.warn("Could not mark file as deleted:", err);
  }
}

export function getLocalFiles(): SalesFile[] {
  try {
    const raw = scopedStorage().getItem(scopedKey(STORAGE_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const deleted = new Set(getDeletedFileIds());
    return Array.isArray(parsed) ? parsed.filter(f => !deleted.has(f.id)) : [];
  } catch (err) {
    console.warn("Could not load local files from localStorage:", err);
    return [];
  }
}

export function saveLocalFile(file: SalesFile): void {
  try {
    // Unmark as deleted if it was previously marked
    const deleted = getDeletedFileIds().filter(id => id !== file.id);
    scopedStorage().setItem(scopedKey(DELETED_FILES_KEY), JSON.stringify(deleted));

    const current = getLocalFiles();
    const idx = current.findIndex(f => f.id === file.id);
    if (idx >= 0) {
      current[idx] = { ...current[idx], ...file };
    } else {
      current.unshift(file);
    }
    scopedStorage().setItem(scopedKey(STORAGE_KEY), JSON.stringify(current));
  } catch (err) {
    console.warn("Could not save local file to localStorage:", err);
  }
}

export function saveLocalFileRecords(fileId: string, records: any[]): void {
  try {
    scopedStorage().setItem(scopedRecordsKey(fileId), JSON.stringify(records.slice(0, 5000)));
  } catch (err) {
    console.warn("Could not save full records to localStorage quota:", err);
  }
}

export function getLocalFileRecords(fileId: string): any[] {
  if (fileId === DEFAULT_STANDARD_FILE.id || fileId === 'default_sales_sample') {
    return SAMPLE_5000_RECORDS;
  }
  try {
    const raw = scopedStorage().getItem(scopedRecordsKey(fileId));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Could not load records from localStorage:", err);
    return [];
  }
}

export function deleteLocalFile(fileId: string): void {
  try {
    markFileAsDeleted(fileId);
    const current = getLocalFiles().filter(f => f.id !== fileId);
    scopedStorage().setItem(scopedKey(STORAGE_KEY), JSON.stringify(current));
    scopedStorage().removeItem(scopedRecordsKey(fileId));
  } catch (err) {
    console.warn("Could not delete local file from localStorage:", err);
  }
}

export function clearAllLocalFiles(): void {
  try {
    const existing = getLocalFiles();
    existing.forEach(f => markFileAsDeleted(f.id));
    DEFAULT_SAMPLE_IDS.forEach(id => markFileAsDeleted(id));
    scopedStorage().removeItem(scopedKey(STORAGE_KEY));
  } catch (err) {
    console.warn("Could not clear local files:", err);
  }
}

export function mergeFiles(firestoreFiles: SalesFile[], localFiles: SalesFile[] = getLocalFiles()): SalesFile[] {
  const map = new Map<string, SalesFile>();
  const deletedIds = new Set(getDeletedFileIds());
  const includeDefaultSample = !getActiveDemoId();

  // Check if any sample ID was deleted or if real files exist
  const sampleDeleted = DEFAULT_SAMPLE_IDS.some(id => deletedIds.has(id));
  const validLocalFiles = localFiles.filter(lf => !deletedIds.has(lf.id) && !DEFAULT_SAMPLE_IDS.includes(lf.id));
  const validFirestoreFiles = firestoreFiles.filter(ff => !deletedIds.has(ff.id) && !DEFAULT_SAMPLE_IDS.includes(ff.id));

  // Add default file ONLY if no real files exist anywhere AND sample file wasn't deleted
  if (includeDefaultSample && !sampleDeleted && validLocalFiles.length === 0 && validFirestoreFiles.length === 0) {
    map.set(DEFAULT_STANDARD_FILE.id, DEFAULT_STANDARD_FILE);
  }

  // Add valid local files
  for (const lf of validLocalFiles) {
    map.set(lf.id, lf);
  }

  // Merge valid firestore files
  for (const ff of validFirestoreFiles) {
    const existing = map.get(ff.id);
    if (existing) {
      map.set(ff.id, {
        ...existing,
        ...ff,
        sampleRows: (ff.sampleRows && ff.sampleRows.length > 0) ? ff.sampleRows : (existing.sampleRows || [])
      });
    } else {
      map.set(ff.id, ff);
    }
  }

  const result = Array.from(map.values());
  result.sort((a, b) => {
    const getTime = (d: any) => {
      if (!d) return 0;
      if (typeof d.toDate === 'function') return d.toDate().getTime();
      if (typeof d === 'string' || typeof d === 'number') return new Date(d).getTime();
      return 0;
    };
    return getTime(b.uploadDate) - getTime(a.uploadDate);
  });

  return result;
}

export async function syncLocalFilesToFirestore(db: any, ownerId?: string): Promise<void> {
  try {
    if (getActiveDemoId() || ownerId?.startsWith('demo_')) {
      return;
    }
    const deletedIds = new Set(getDeletedFileIds());
    const localFiles = getLocalFiles().filter(f => !deletedIds.has(f.id));
    const realLocalFiles = localFiles.filter(f => !DEFAULT_SAMPLE_IDS.includes(f.id));
    if (!deletedIds.has(DEFAULT_STANDARD_FILE.id) && realLocalFiles.length === 0 && !localFiles.some(f => f.id === DEFAULT_STANDARD_FILE.id)) {
      localFiles.push(DEFAULT_STANDARD_FILE);
    }

    for (const file of localFiles) {
      if (!file.id) continue;
      try {
        const records = getLocalFileRecords(file.id);
        const sampleRowsToUse = (records && records.length > 0 ? records : file.sampleRows || []).slice(0, 30);

        const docPayload = sanitizeForFirestore({
          ownerId: ownerId || (file as any).ownerId || 'shared_user',
          createdBy: ownerId || (file as any).createdBy || 'shared_user',
          fileName: file.fileName,
          uploadDate: file.uploadDate || new Date().toISOString(),
          uploadedBy: file.uploadedBy || 'Hệ thống',
          status: 'COMPLETED',
          recordCount: file.recordCount || (records ? records.length : 0),
          metadata: file.metadata || 'xlsx',
          embeddingStatus: 'READY',
          sampleRows: sampleRowsToUse
        });

        await setDoc(doc(db, 'files', file.id), docPayload, { merge: true });

        // Optionally sync subcollection records if available
        if (records && records.length > 0 && records.length <= 500) {
          const batch = writeBatch(db);
          let count = 0;
          records.slice(0, 100).forEach((rec: any, idx: number) => {
            const rRef = doc(db, `files/${file.id}/records`, `rec_${idx}`);
            batch.set(rRef, sanitizeForFirestore({ ...rec, fileId: file.id }), { merge: true });
            count++;
          });
          if (count > 0) {
            await batch.commit().catch(() => {});
          }
        }
      } catch (fErr) {
        console.warn(`Notice syncing file ${file.id} to Firestore:`, fErr);
      }
    }
  } catch (err) {
    console.warn("Global sync to Firestore notice:", err);
  }
}
