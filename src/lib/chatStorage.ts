import { ChatSession, ChatMessage } from '@/types';
import { doc, setDoc, writeBatch, collection } from 'firebase/firestore';

const SESSIONS_STORAGE_KEY = 'sales_intel_chat_sessions';
const MESSAGES_PREFIX = 'sales_intel_chat_msgs_';

export function getLocalSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Could not read local chat sessions:", err);
    return [];
  }
}

export function saveLocalSession(session: ChatSession): void {
  try {
    const current = getLocalSessions();
    const idx = current.findIndex(s => s.id === session.id);
    if (idx >= 0) {
      current[idx] = { ...current[idx], ...session };
    } else {
      current.unshift(session);
    }
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    console.warn("Could not save local chat session:", err);
  }
}

export function deleteLocalSession(sessionId: string): void {
  try {
    const current = getLocalSessions().filter(s => s.id !== sessionId);
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(current));
    localStorage.removeItem(`${MESSAGES_PREFIX}${sessionId}`);
  } catch (err) {
    console.warn("Could not delete local chat session:", err);
  }
}

export function clearAllLocalSessions(): void {
  try {
    const sessions = getLocalSessions();
    sessions.forEach(s => localStorage.removeItem(`${MESSAGES_PREFIX}${s.id}`));
    localStorage.removeItem(SESSIONS_STORAGE_KEY);
  } catch (err) {
    console.warn("Could not clear local chat sessions:", err);
  }
}

export function getLocalMessages(sessionId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`${MESSAGES_PREFIX}${sessionId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`Could not read local messages for session ${sessionId}:`, err);
    return [];
  }
}

export function saveLocalMessage(sessionId: string, message: ChatMessage): void {
  try {
    const current = getLocalMessages(sessionId);
    const idx = current.findIndex(m => m.id === message.id);
    if (idx >= 0) {
      current[idx] = { ...current[idx], ...message };
    } else {
      current.push(message);
    }
    localStorage.setItem(`${MESSAGES_PREFIX}${sessionId}`, JSON.stringify(current));
  } catch (err) {
    console.warn(`Could not save local message for session ${sessionId}:`, err);
  }
}

export function mergeSessions(firestoreSessions: ChatSession[], localSessions: ChatSession[] = getLocalSessions()): ChatSession[] {
  const map = new Map<string, ChatSession>();

  for (const ls of localSessions) {
    map.set(ls.id, ls);
  }

  for (const fs of firestoreSessions) {
    const existing = map.get(fs.id);
    if (existing) {
      map.set(fs.id, { ...existing, ...fs });
    } else {
      map.set(fs.id, fs);
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
    return getMs(b.lastUpdated) - getMs(a.lastUpdated);
  });

  return list;
}

export async function syncLocalSessionsToFirestore(db: any): Promise<void> {
  try {
    const localSessions = getLocalSessions();
    for (const session of localSessions) {
      if (!session.id) continue;
      try {
        const payload = {
          userId: session.userId || 'shared_user',
          title: session.title || 'Cuộc hội thoại',
          lastUpdated: session.lastUpdated || new Date().toISOString(),
          sourceFiles: session.sourceFiles || []
        };
        await setDoc(doc(db, 'chat_sessions', session.id), payload, { merge: true });

        const msgs = getLocalMessages(session.id);
        if (msgs && msgs.length > 0) {
          const batch = writeBatch(db);
          msgs.forEach((m) => {
            const mRef = doc(db, `chat_sessions/${session.id}/messages`, m.id);
            batch.set(mRef, {
              sessionId: session.id,
              role: m.role,
              content: m.content || '',
              timestamp: m.timestamp || new Date().toISOString(),
              usedCitations: m.usedCitations || []
            }, { merge: true });
          });
          await batch.commit().catch(() => {});
        }
      } catch (sErr) {
        console.warn(`Sync session ${session.id} to Firestore notice:`, sErr);
      }
    }
  } catch (err) {
    console.warn("Global chat sync to Firestore notice:", err);
  }
}
