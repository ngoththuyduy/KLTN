import { Report } from '@/types';
import { doc, setDoc } from 'firebase/firestore';

const REPORTS_STORAGE_KEY = 'sales_intel_reports';

export function getLocalReports(): Report[] {
  try {
    const raw = localStorage.getItem(REPORTS_STORAGE_KEY);
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
    localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(current));
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

export async function syncLocalReportsToFirestore(db: any): Promise<void> {
  try {
    const local = getLocalReports();
    for (const report of local) {
      if (!report.id) continue;
      try {
        await setDoc(doc(db, 'reports', report.id), {
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
