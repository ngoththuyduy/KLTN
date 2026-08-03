import { Report } from '@/types';
import { doc, setDoc } from 'firebase/firestore';

const REPORTS_STORAGE_KEY = 'sales_intel_reports';

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

export function getLocalReports(): Report[] {
  try {
    const raw = scopedStorage().getItem(scopedKey(REPORTS_STORAGE_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Could not read local reports:", err);
    return [];
  }
}

export function saveLocalReport(report: Report): void {
  try {
    const current = getLocalReports();
    const idx = current.findIndex(r => r.id === report.id);
    if (idx >= 0) {
      current[idx] = { ...current[idx], ...report };
    } else {
      current.unshift(report);
    }
    scopedStorage().setItem(scopedKey(REPORTS_STORAGE_KEY), JSON.stringify(current));
  } catch (err) {
    console.warn("Could not save local report:", err);
  }
}

export function mergeReports(firestoreReports: Report[], localReports: Report[] = getLocalReports()): Report[] {
  const map = new Map<string, Report>();

  for (const lr of localReports) {
    map.set(lr.id, lr);
  }

  for (const fr of firestoreReports) {
    const existing = map.get(fr.id);
    if (existing) {
      map.set(fr.id, { ...existing, ...fr });
    } else {
      map.set(fr.id, fr);
    }
  }

  const list = Array.from(map.values());
  list.sort((a, b) => {
    const getMs = (dateVal: any) => {
      if (!dateVal) return 0;
      if (typeof dateVal.toDate === 'function') return dateVal.toDate().getTime();
      if (dateVal.seconds) return dateVal.seconds * 1000;
      const parsed = Date.parse(dateVal);
      return isNaN(parsed) ? 0 : parsed;
    };
    return getMs(b.createdAt) - getMs(a.createdAt);
  });

  return list;
}

export async function syncLocalReportsToFirestore(db: any, ownerId?: string): Promise<void> {
  try {
    if (getActiveDemoId() || ownerId?.startsWith('demo_')) {
      return;
    }
    const local = getLocalReports();
    for (const report of local) {
      if (!report.id) continue;
      try {
        await setDoc(doc(db, 'reports', report.id), {
          ownerId: ownerId || (report as any).ownerId || 'shared_user',
          createdBy: ownerId || (report as any).createdBy || 'shared_user',
          title: report.title || 'Báo cáo',
          content: report.content || '',
          generatedBy: report.generatedBy || 'AI System',
          createdAt: report.createdAt || new Date().toISOString(),
          fileType: report.fileType || 'PDF',
          reportType: report.reportType || 'DAILY'
        }, { merge: true });
      } catch (err) {
        console.warn(`Sync report ${report.id} to Firestore notice:`, err);
      }
    }
  } catch (err) {
    console.warn("Global reports sync notice:", err);
  }
}
