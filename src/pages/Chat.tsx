import React, { useState, useRef, useEffect } from 'react';
import { 
  Send,
  Bot, 
  User, 
  Plus, 
  Search, 
  Database, 
  Sparkles,
  Paperclip,
  TrendingUp,
  BarChart2,
  Table as TableIcon,
  RefreshCw,
  MoreVertical,
  Layers,
  MessageSquare,
  ChevronDown,
  Mic,
  MicOff,
  Sliders,
  CheckCircle,
  HelpCircle,
  FileSpreadsheet,
  FileText,
  X,
  Trash2,
  AlertTriangle,
  Pencil,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { collection, query, orderBy, onSnapshot, addDoc, getDocs, doc, setDoc, serverTimestamp, where, limit, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { chatWithAI, modelName } from '@/lib/gemini';
import { queryRAG } from '@/services/ragService';
import { ChatSession, ChatMessage, SalesFile } from '@/types';
import { useAuth } from '@/lib/AuthContext';
import { 
  getLocalSessions, 
  saveLocalSession, 
  deleteLocalSession, 
  clearAllLocalSessions, 
  getLocalMessages, 
  saveLocalMessage, 
  mergeSessions, 
  syncLocalSessionsToFirestore 
} from '@/lib/chatStorage';
import { 
  getLocalFiles, 
  mergeFiles, 
  syncLocalFilesToFirestore 
} from '@/lib/fileStorage';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

export default function Chat() {
  const { profile, user } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<SalesFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [useVector, setUseVector] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [showRagDebugger, setShowRagDebugger] = useState(false);
  const [topK, setTopK] = useState(10);
  const [threshold, setThreshold] = useState(0.35);
  const [lastRagDetails, setLastRagDetails] = useState<{
    queryText?: string;
    queryVector?: number[];
    systemInstruction?: string;
    citations?: { fileName: string; text: string; score: number }[];
    retrievedContext?: string;
  } | null>(null);

  // Non-blocking states for safe deletion inside iframes
  const [deleteConfirmSessionId, setDeleteConfirmSessionId] = useState<string | null>(null);
  const [deleteConfirmSessionTitle, setDeleteConfirmSessionTitle] = useState<string>('');
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  
  // Renaming states
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. Sync local sessions & files to Firestore in background
    syncLocalSessionsToFirestore(db).catch(err => console.warn("Sync sessions error:", err));
    syncLocalFilesToFirestore(db).catch(err => console.warn("Sync files error:", err));

    // 2. Load local sessions instantly so UI renders without delay
    setSessions(mergeSessions([], getLocalSessions()));

    // 3. Listen to Firestore chat_sessions globally
    const primaryQuery = query(collection(db, 'chat_sessions'));

    const unsubscribe = onSnapshot(primaryQuery, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatSession));
      const merged = mergeSessions(docs, getLocalSessions());
      setSessions(merged);
    }, (error) => {
      console.warn('onSnapshot error for chat_sessions, fallback to local sessions:', error);
      setSessions(mergeSessions([], getLocalSessions()));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'files'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedFiles = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SalesFile));
      const merged = mergeFiles(loadedFiles, getLocalFiles());
      setFiles(merged);
      
      // Keep only selected IDs that actually exist in current merged files
      setSelectedFiles(prev => {
        const fileIds = merged.map(f => f.id);
        const valid = prev.filter(id => fileIds.includes(id));
        if (valid.length === 0 && merged.length > 0) {
          return fileIds;
        }
        return valid;
      });
    }, (error) => {
      console.warn('Files list error, using local files fallback:', error);
      const localMerged = mergeFiles([], getLocalFiles());
      setFiles(localMerged);
      setSelectedFiles(prev => {
        const fileIds = localMerged.map(f => f.id);
        const valid = prev.filter(id => fileIds.includes(id));
        if (valid.length === 0 && localMerged.length > 0) {
          return fileIds;
        }
        return valid;
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentSession) {
      setMessages([]);
      return;
    }

    // Load local messages instantly first
    const initialLocalMsgs = getLocalMessages(currentSession.id);
    setMessages(initialLocalMsgs);

    const q = collection(db, `chat_sessions/${currentSession.id}/messages`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const firestoreMsgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
      firestoreMsgs.forEach(m => saveLocalMessage(currentSession.id, m));

      const localCurrent = getLocalMessages(currentSession.id);
      const msgMap = new Map<string, ChatMessage>();
      localCurrent.forEach(m => msgMap.set(m.id, m));
      firestoreMsgs.forEach(m => msgMap.set(m.id, m));

      const combined = Array.from(msgMap.values());
      combined.sort((a, b) => {
        const getMs = (val: any) => {
          if (!val) return 0;
          if (typeof val.toDate === 'function') return val.toDate().getTime();
          if (val.seconds) return val.seconds * 1000;
          const parsed = Date.parse(val);
          return isNaN(parsed) ? 0 : parsed;
        };
        return getMs(a.timestamp) - getMs(b.timestamp);
      });
      setMessages(combined);
    }, (error) => {
      console.warn(`onSnapshot error for messages in session ${currentSession.id}, using local fallback:`, error);
      setMessages(getLocalMessages(currentSession.id));
    });
    return unsubscribe;
  }, [currentSession]);

  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [messages]);

  const handleSelectSession = (session: ChatSession) => {
    setCurrentSession(session);
    if (session.sourceFiles && Array.isArray(session.sourceFiles) && session.sourceFiles.length > 0) {
      setSelectedFiles(session.sourceFiles);
    } else {
      setSelectedFiles(files.map(f => f.id));
    }
  };

  useEffect(() => {
    if (sessions.length > 0 && !currentSession) {
      handleSelectSession(sessions[0]);
    }
  }, [sessions, currentSession]);

  const handleCreateSession = async (initialQuery?: string) => {
    const activeUserId = profile?.id || user?.uid || 'shared_user';
    const newSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const newSessionObj: ChatSession = {
      id: newSessionId,
      userId: activeUserId,
      title: initialQuery ? (initialQuery.length > 30 ? initialQuery.substring(0, 30) + '...' : initialQuery) : 'Cuộc hội thoại mới',
      lastUpdated: new Date().toISOString(),
      sourceFiles: selectedFiles.length > 0 ? selectedFiles : files.map(f => f.id)
    };

    saveLocalSession(newSessionObj);
    setSessions(prev => mergeSessions([], [newSessionObj, ...prev]));
    setCurrentSession(newSessionObj);

    try {
      await setDoc(doc(db, 'chat_sessions', newSessionId), {
        userId: activeUserId,
        title: newSessionObj.title,
        lastUpdated: new Date().toISOString(),
        sourceFiles: newSessionObj.sourceFiles
      });
    } catch (err) {
      console.warn("Firestore save session notice (retained locally):", err);
    }

    if (initialQuery) {
      await sendInitialMessage(newSessionObj, initialQuery);
    }
  };

  const sendInitialMessage = async (session: ChatSession, text: string) => {
    setIsLoading(true);
    try {
      const userMsgId = 'msg_' + Date.now() + '_user';
      const userMsgObj: ChatMessage = {
        id: userMsgId,
        sessionId: session.id,
        role: 'user',
        content: text,
        timestamp: new Date().toISOString()
      };
      saveLocalMessage(session.id, userMsgObj);
      setMessages(prev => [...prev, userMsgObj]);

      const msgPath = `chat_sessions/${session.id}/messages`;
      setDoc(doc(db, msgPath, userMsgId), {
        sessionId: session.id,
        role: 'user',
        content: text,
        timestamp: new Date().toISOString()
      }).catch(err => console.warn("Firestore write notice:", err));

      const result = await queryRAG(text, selectedFiles, [], topK, threshold);

      setLastRagDetails({
        queryText: text,
        queryVector: result.queryVector,
        systemInstruction: result.systemInstruction,
        citations: result.citations,
        retrievedContext: result.retrievedContext
      });

      const aiMsgId = 'msg_' + Date.now() + '_assistant';
      const aiMsgObj: ChatMessage = {
        id: aiMsgId,
        sessionId: session.id,
        role: 'assistant',
        content: result.answer,
        usedCitations: result.usedCitations,
        timestamp: new Date().toISOString()
      };
      saveLocalMessage(session.id, aiMsgObj);
      setMessages(prev => [...prev, aiMsgObj]);

      setDoc(doc(db, msgPath, aiMsgId), {
        sessionId: session.id,
        role: 'assistant',
        content: result.answer,
        usedCitations: result.usedCitations || [],
        timestamp: new Date().toISOString()
      }).catch(err => console.warn("Firestore write notice:", err));

      // Update parent session lastUpdated & title
      const nowIso = new Date().toISOString();
      const autoTitle = (session.title === 'Cuộc hội thoại mới' || !session.title)
        ? (text.length > 30 ? text.substring(0, 30) + '...' : text)
        : session.title;
      const updatedSessObj: ChatSession = { ...session, title: autoTitle, lastUpdated: nowIso };
      saveLocalSession(updatedSessObj);
      setCurrentSession(updatedSessObj);
      setSessions(prev => mergeSessions([], [updatedSessObj, ...prev]));

      setDoc(doc(db, 'chat_sessions', session.id), {
        userId: updatedSessObj.userId || 'shared_user',
        title: autoTitle,
        lastUpdated: nowIso,
        sourceFiles: updatedSessObj.sourceFiles || []
      }, { merge: true }).catch(err => console.warn("Firestore session update notice:", err));

    } catch (error) {
      console.error(error);
      toast.error('Lỗi khi gửi câu hỏi nhanh');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent, directText?: string) => {
    e?.preventDefault();
    const userText = directText || input;
    if (!userText.trim() || !currentSession || isLoading) return;

    if (!directText) {
      setInput('');
    }
    setIsLoading(true);

    try {
      const userMsgId = 'msg_' + Date.now() + '_user';
      const userMsgObj: ChatMessage = {
        id: userMsgId,
        sessionId: currentSession.id,
        role: 'user',
        content: userText,
        timestamp: new Date().toISOString()
      };
      saveLocalMessage(currentSession.id, userMsgObj);
      setMessages(prev => [...prev, userMsgObj]);

      const msgPath = `chat_sessions/${currentSession.id}/messages`;
      setDoc(doc(db, msgPath, userMsgId), {
        sessionId: currentSession.id,
        role: 'user',
        content: userText,
        timestamp: new Date().toISOString()
      }).catch(err => console.warn("Firestore write notice:", err));

      const history = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const result = await queryRAG(userText, selectedFiles, history, topK, threshold);

      setLastRagDetails({
        queryText: userText,
        queryVector: result.queryVector,
        systemInstruction: result.systemInstruction,
        citations: result.citations,
        retrievedContext: result.retrievedContext
      });

      const aiMsgId = 'msg_' + Date.now() + '_assistant';
      const aiMsgObj: ChatMessage = {
        id: aiMsgId,
        sessionId: currentSession.id,
        role: 'assistant',
        content: result.answer,
        usedCitations: result.usedCitations,
        timestamp: new Date().toISOString()
      };
      saveLocalMessage(currentSession.id, aiMsgObj);
      setMessages(prev => [...prev, aiMsgObj]);

      setDoc(doc(db, msgPath, aiMsgId), {
        sessionId: currentSession.id,
        role: 'assistant',
        content: result.answer,
        usedCitations: result.usedCitations || [],
        timestamp: new Date().toISOString()
      }).catch(err => console.warn("Firestore write notice:", err));

      // Update parent session lastUpdated & title
      const nowIso = new Date().toISOString();
      const autoTitle = (currentSession.title === 'Cuộc hội thoại mới' || !currentSession.title)
        ? (userText.length > 30 ? userText.substring(0, 30) + '...' : userText)
        : currentSession.title;
      const updatedSessObj: ChatSession = { ...currentSession, title: autoTitle, lastUpdated: nowIso };
      saveLocalSession(updatedSessObj);
      setCurrentSession(updatedSessObj);
      setSessions(prev => mergeSessions([], [updatedSessObj, ...prev]));

      setDoc(doc(db, 'chat_sessions', currentSession.id), {
        userId: updatedSessObj.userId || 'shared_user',
        title: autoTitle,
        lastUpdated: nowIso,
        sourceFiles: updatedSessObj.sourceFiles || []
      }, { merge: true }).catch(err => console.warn("Firestore session update notice:", err));

    } catch (error) {
      console.error(error);
      toast.error('Lỗi khi gửi tin nhắn');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleFile = async (fileId: string) => {
    const updated = selectedFiles.includes(fileId)
      ? selectedFiles.filter(id => id !== fileId)
      : [...selectedFiles, fileId];
    
    setSelectedFiles(updated);

    if (currentSession) {
      const nowIso = new Date().toISOString();
      const updatedSessionObj = {
        ...currentSession,
        sourceFiles: updated,
        lastUpdated: nowIso
      };
      saveLocalSession(updatedSessionObj);
      setCurrentSession(updatedSessionObj);
      setSessions(prev => prev.map(s => s.id === currentSession.id ? updatedSessionObj : s));

      try {
        await setDoc(doc(db, 'chat_sessions', currentSession.id), {
          sourceFiles: updated,
          lastUpdated: nowIso
        }, { merge: true });
      } catch (err) {
        console.warn("Notice updating session sourceFiles in Firestore:", err);
      }
    }
  };

  const handleStartRename = (session: ChatSession, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title || '');
  };

  const handleSaveRename = async (sessionId: string) => {
    if (!editingTitle.trim()) {
      toast.error('Tên cuộc hội thoại không được để trống');
      return;
    }
    const cleanTitle = editingTitle.trim();
    try {
      const existing = sessions.find(s => s.id === sessionId);
      if (existing) {
        const updated = { ...existing, title: cleanTitle, lastUpdated: new Date().toISOString() };
        saveLocalSession(updated);
        setSessions(prev => prev.map(s => s.id === sessionId ? updated : s));
      }
      setDoc(doc(db, 'chat_sessions', sessionId), {
        title: cleanTitle,
        lastUpdated: new Date().toISOString()
      }, { merge: true }).catch(err => console.warn("Rename notice:", err));

      if (currentSession?.id === sessionId) {
        setCurrentSession(prev => prev ? { ...prev, title: cleanTitle } : null);
      }
      setEditingSessionId(null);
      toast.success('Đã đổi tên cuộc hội thoại thành công');
    } catch (err) {
      console.error('Failed to rename session:', err);
      toast.error('Lỗi khi đổi tên cuộc hội thoại');
    }
  };

  const handleCancelRename = () => {
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const handleDeleteSession = (sessionId: string, sessionTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmSessionId(sessionId);
    setDeleteConfirmSessionTitle(sessionTitle || 'Cuộc hội thoại này');
  };

  const executeDeleteSession = async () => {
    if (!deleteConfirmSessionId) return;
    try {
      const idToDelete = deleteConfirmSessionId;
      setDeleteConfirmSessionId(null);
      deleteLocalSession(idToDelete);
      setSessions(prev => prev.filter(s => s.id !== idToDelete));
      deleteDoc(doc(db, 'chat_sessions', idToDelete)).catch(err => console.warn("Delete session notice:", err));
      toast.success('Đã xóa cuộc hội thoại thành công');
      if (currentSession?.id === idToDelete) {
        setCurrentSession(null);
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
      toast.error('Lỗi khi xóa cuộc hội thoại');
    }
  };

  const handleClearAllSessions = () => {
    if (sessions.length === 0) return;
    setClearAllConfirmOpen(true);
  };

  const executeClearAllSessions = async () => {
    setClearAllConfirmOpen(false);
    const loadToastId = toast.loading('Đang dọn sạch toàn bộ lịch sử...');
    try {
      clearAllLocalSessions();
      setSessions([]);
      setCurrentSession(null);
      setMessages([]);

      const snapshot = await getDocs(collection(db, 'chat_sessions'));
      const batch = writeBatch(db);
      snapshot.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit().catch(() => {});

      toast.dismiss(loadToastId);
      toast.success('Đã dọn sạch toàn bộ lịch sử hội thoại');
    } catch (err) {
      toast.dismiss(loadToastId);
      console.error('Failed to clear all sessions:', err);
      toast.error('Lỗi khi dọn sạch lịch sử');
    }
  };

  return (
    <div className="flex h-[calc(100vh-160px)] gap-6 antialiased">
      {/* Sidebar - Sessions & Sources */}
      <aside className="hidden lg:flex flex-col w-72 space-y-6">
        <Button 
          onClick={() => handleCreateSession()}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-6 rounded-2xl shadow-md border-none"
        >
          <Plus className="mr-2" size={20} /> Hội thoại mới
        </Button>

        <Card className="bg-white border border-sky-100/50 shadow-md shadow-sky-500/5 rounded-3xl overflow-hidden flex flex-col flex-1">
          <div className="p-4.5 bg-gradient-to-r from-sky-50/50 to-transparent border-b border-sky-100/30 flex items-center justify-between">
             <h3 className="text-[15px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-2">
               <RefreshCw size={14} className="text-indigo-500" /> Lịch sử gần đây
             </h3>
             {sessions.length > 0 && (
               <button 
                 onClick={handleClearAllSessions}
                 className="text-[12px] text-rose-600 hover:text-rose-700 font-bold transition-colors cursor-pointer"
                 title="Xóa tất cả lịch sử hội thoại"
               >
                 Xóa tất cả
               </button>
             )}
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2.5 space-y-1">
              {sessions.map(s => {
                const isEditing = editingSessionId === s.id;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "w-full rounded-xl transition-all duration-200 group flex items-center justify-between border border-transparent p-1.5",
                      currentSession?.id === s.id 
                        ? "bg-indigo-50/70 border-indigo-100/50 text-indigo-700 font-bold shadow-xs" 
                        : "text-slate-600 hover:bg-sky-50/40 hover:border-sky-100/40"
                    )}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-1 w-full px-1">
                        <Input
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(s.id);
                            if (e.key === 'Escape') handleCancelRename();
                          }}
                          autoFocus
                          className="h-8 text-[14px] font-bold bg-white border-indigo-300 focus-visible:ring-1 focus-visible:ring-indigo-500 rounded-lg px-2 flex-1"
                        />
                        <button
                          onClick={() => handleSaveRename(s.id)}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors shrink-0 cursor-pointer"
                          title="Lưu tên"
                        >
                          <Check size={14} strokeWidth={2.5} />
                        </button>
                        <button
                          onClick={handleCancelRename}
                          className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors shrink-0 cursor-pointer"
                          title="Hủy"
                        >
                          <X size={14} strokeWidth={2.5} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleSelectSession(s)}
                          className="flex-1 text-left px-2 py-1 flex items-center gap-2.5 min-w-0"
                        >
                          <MessageSquare size={16} className={cn("shrink-0", currentSession?.id === s.id ? "text-indigo-600" : "text-slate-400 group-hover:text-indigo-500")} />
                          <span className="truncate text-[15px]">{s.title}</span>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => handleStartRename(s, e)}
                            className="p-1.5 text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100/50 rounded-lg transition-all shrink-0 cursor-pointer flex items-center justify-center shadow-xs"
                            title="Đổi tên cuộc trò chuyện"
                          >
                            <Pencil size={13} strokeWidth={2.5} />
                          </button>
                          <button
                            onClick={(e) => handleDeleteSession(s.id, s.title, e)}
                            className="p-1.5 text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-100/50 rounded-lg transition-all shrink-0 cursor-pointer flex items-center justify-center shadow-xs"
                            title="Xóa hội thoại"
                          >
                            <Trash2 size={13} strokeWidth={2.5} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </Card>

        {/* Source Selector */}
        <Card className="bg-white border border-sky-100/50 shadow-md shadow-sky-500/5 rounded-3xl overflow-hidden h-64 flex flex-col">
          <div className="p-4.5 bg-gradient-to-r from-sky-50/50 to-transparent border-b border-sky-100/30 flex items-center justify-between">
             <h3 className="text-[15px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-2">
               <Layers size={14} className="text-indigo-500" /> Nguồn dữ liệu ({files.length > 0 ? (selectedFiles.length === files.length ? `${files.length}` : `${selectedFiles.length}/${files.length}`) : 0})
             </h3>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2.5 space-y-1">
              {files.map(f => (
                <div 
                  key={f.id} 
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 group",
                    selectedFiles.includes(f.id)
                      ? "bg-emerald-50/40 border-emerald-100/60 shadow-xs"
                      : "border-transparent hover:bg-sky-50/40 hover:border-sky-100/40"
                  )}
                >
                  <Checkbox 
                    id={`file-${f.id}`} 
                    checked={selectedFiles.includes(f.id)}
                    onCheckedChange={() => toggleFile(f.id)}
                    className="border-slate-300 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 rounded"
                  />
                  <div className={cn(
                    "p-1.5 rounded-lg shrink-0 transition-colors",
                    selectedFiles.includes(f.id)
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600"
                  )}>
                    <FileSpreadsheet size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label 
                      htmlFor={`file-${f.id}`} 
                      className="text-[15px] font-bold text-slate-700 truncate cursor-pointer select-none leading-tight block"
                    >
                      {f.fileName}
                    </label>
                    <span className="text-[12px] font-bold text-slate-400 block mt-0.5">
                      {f.recordCount || 0} bản ghi
                    </span>
                  </div>
                </div>
              ))}
              {files.length === 0 && (
                <p className="px-4 py-8 text-center text-[15px] font-medium text-slate-400 italic">
                  Chưa có dữ liệu. Hãy tải lên file Excel trước.
                </p>
              )}
            </div>
          </ScrollArea>
        </Card>
      </aside>

      {/* Main Chat Area */}
      <section className="flex-1 flex flex-col bg-white rounded-3xl shadow-md shadow-sky-500/5 border border-sky-100/50 overflow-hidden relative">
        {!currentSession ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-6">
            <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center text-indigo-600 animate-bounce">
              <Bot size={40} />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-[27px] font-black text-slate-900 tracking-tight">Trợ lý AI Sales Intel</h2>
              <p className="text-slate-500 font-medium leading-relaxed">
                Nạp dữ liệu của bạn, chọn nguồn và bắt đầu đặt câu hỏi. Tôi sẽ giúp bạn phân tích xu hướng, doanh số và dự báo tương lai.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl animate-fade-in">
              <QuickAction 
                icon={AlertTriangle} 
                label="⚠️ Phân Tích Chủ Động & Cảnh Báo" 
                sublabel="Tự động quét chéo trùng lặp, lỗi âm đơn, rủi ro tồn và sụt giảm" 
                onClick={() => handleCreateSession("Hãy thực hiện một buổi 'Phân tích Chủ động & Cảnh báo Sớm' trên toàn bộ dữ liệu đã nạp. Hãy rà soát và phát hiện toàn bộ các rủi ro vận hành sau đây: 1. Các đơn hàng bị trùng lặp hoàn toàn về giá trị, ngày, sản phẩm và khách hàng. 2. Các dòng dữ liệu bất thường hoặc không hợp lệ (ví dụ số lượng âm hoặc giá bán bằng không). 3. Các cảnh báo tồn kho đỏ (các sản phẩm có tồn kho thực tế dưới 5 chiếc). 4. Các điểm sụt giảm doanh số nghiêm trọng giữa các tháng (giảm >30% MoM). Hãy liệt kê rõ ràng từng lỗi hoặc rủi ro theo dạng Bảng Cảnh báo chuyên nghiệp kèm theo đề xuất xử lý sắc sảo, chỉ rõ nguồn gốc dữ liệu đến từng dòng Excel cụ thể của tệp dữ liệu nguồn.")} 
              />
              <QuickAction 
                icon={FileText} 
                label="Tổng hợp Báo cáo Tháng" 
                sublabel="Tạo tóm tắt doanh số & hiệu quả kinh doanh tháng" 
                onClick={() => handleCreateSession("Hãy tổng hợp dữ liệu giao dịch gần đây và tạo một báo cáo tóm tắt hiệu quả kinh doanh, doanh số và các điểm sáng nổi bật trong tháng.")} 
              />
              <QuickAction 
                icon={TrendingUp} 
                label="Dự báo Tăng trưởng Quý 4" 
                sublabel="Dự báo xu hướng tăng trưởng doanh thu Quý 4" 
                onClick={() => handleCreateSession("Dựa vào chỉ số doanh thu lịch sử hiện có trong dữ liệu, hãy phân tích dự báo xu hướng tăng trưởng doanh số cho Quý 4 sắp tới.")} 
              />
              <QuickAction 
                icon={BarChart2} 
                label="Phân tích Biên Lợi nhuận" 
                sublabel="Phân tích tỷ suất biên lợi nhuận giữa các dòng hàng" 
                onClick={() => handleCreateSession("So sánh tỷ suất biên lợi nhuận ròng giữa các dòng sản phẩm (ví dụ Laptop vs Phụ kiện) và chỉ ra nhóm hàng tối ưu lợi nhuận nhất.")} 
              />
              <QuickAction 
                icon={User} 
                label="Tìm Khách hàng VIP" 
                sublabel="Xếp hạng 5 đối tác/khách hàng đóng góp lớn nhất" 
                onClick={() => handleCreateSession("Tìm và liệt kê TOP 5 khách hàng tiềm năng đóng góp doanh số tích lũy nhiều nhất trong nguồn dữ liệu hệ thống.")} 
              />
              <QuickAction 
                icon={TableIcon} 
                label="Hiệu suất theo Khu vực" 
                sublabel="Báo cáo hiệu suất kinh doanh theo khu vực" 
                onClick={() => handleCreateSession("Báo cáo và so sánh chi tiết doanh thu giữa các khu vực địa lý vùng miền.")} 
              />
              <QuickAction 
                icon={Database} 
                label="Kiểm tra Cấu trúc Dữ liệu" 
                sublabel="Xem định dạng, cột và kiểu dữ liệu hiện có" 
                onClick={() => handleCreateSession("Hãy mô tả định dạng, các cột dữ liệu hiện tại đang có trong nguồn dữ liệu này.")} 
              />
            </div>
            <Button onClick={() => handleCreateSession()} className="bg-indigo-600 hover:bg-indigo-700 px-8 py-6 rounded-2xl font-bold">
              Bắt đầu hội thoại mới
            </Button>
          </div>
        ) : (
          <>
            {/* Sleek Header Bar */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center shrink-0">
                  <MessageSquare size={16} />
                </div>
                {editingSessionId === currentSession.id ? (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(currentSession.id);
                        if (e.key === 'Escape') handleCancelRename();
                      }}
                      autoFocus
                      className="h-8 text-[15px] font-bold bg-white border-indigo-300 focus-visible:ring-1 focus-visible:ring-indigo-500 rounded-lg px-2.5 min-w-[200px]"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSaveRename(currentSession.id)}
                      className="h-8 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    >
                      <Check size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleCancelRename}
                      className="h-8 px-2 rounded-lg text-slate-400 hover:text-slate-600"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[17px] font-black text-slate-800 truncate leading-tight">{currentSession.title}</h3>
                      <button
                        onClick={() => handleStartRename(currentSession)}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors shrink-0 cursor-pointer"
                        title="Đổi tên cuộc trò chuyện"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                    <span className="text-[13px] font-bold text-slate-400 block mt-0.5">Hệ thống RAG & LLM đang hoạt động</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRagDebugger(p => !p)}
                  className={cn(
                    "rounded-xl gap-1.5 text-[15px] font-black transition-all border border-indigo-150 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100/60 active:scale-95 px-3 py-4",
                    showRagDebugger && "bg-indigo-600 text-white hover:bg-indigo-700 border-indigo-600 hover:text-white"
                  )}
                >
                  <Sliders size={13} />
                  <span>Kính lúp RAG {showRagDebugger ? "(Bật)" : "(Tắt)"}</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => handleDeleteSession(currentSession.id, currentSession.title, e)}
                  className="rounded-xl gap-1.5 text-[15px] font-black transition-all border border-rose-200 text-rose-700 bg-rose-50/50 hover:bg-rose-100/60 active:scale-95 px-3 py-4"
                  title="Xóa cuộc hội thoại này"
                >
                  <Trash2 size={13} />
                  <span>Xóa cuộc trò chuyện</span>
                </Button>
              </div>
            </div>

            {/* Chat Messages */}
            <ScrollArea className="flex-1 p-6 bg-slate-50/20" ref={scrollRef}>
              <div className="space-y-6 max-w-4xl mx-auto">
                <AnimatePresence>
                  {messages.map((m, i) => (
                    <motion.div 
                      key={m.id || i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "flex gap-4",
                        m.role === 'user' ? "flex-row-reverse" : "flex-row"
                      )}
                    >
                      <div className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm transition-transform hover:scale-110",
                        m.role === 'assistant' ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600"
                      )}>
                        {m.role === 'assistant' ? <Bot size={20} /> : <User size={20} />}
                      </div>
                      <div className={cn(
                        "max-w-[85%] rounded-2xl text-[17px] leading-relaxed shadow-sm transition-all border",
                        m.role === 'assistant' 
                          ? "bg-white text-slate-900 border-sky-100/50 p-5 md:p-6 font-medium" 
                          : "bg-indigo-600 text-white font-semibold p-4 border-indigo-500 shadow-indigo-100/30"
                      )}>
                        <div className="markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeRaw, rehypeKatex]}>
                            {m.content}
                          </ReactMarkdown>
                        </div>
                        {m.role === 'assistant' && m.usedCitations && m.usedCitations.length > 0 && (
                          <div className="mt-4 pt-3.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-black uppercase text-indigo-500 tracking-wider">Trích dẫn nguồn RAG:</span>
                            {m.usedCitations.map((src, idx) => (
                              <Badge key={idx} variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-none px-2 py-0.5 text-[13px] font-bold rounded-md">
                                {src}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                  {isLoading && (
                    <motion.div 
                      initial={{ opacity: 0, y: 5 }} 
                      animate={{ opacity: 1, y: 0 }} 
                      className="flex gap-4"
                    >
                      <div className="w-9 h-9 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-md animate-pulse">
                        <Bot size={20} />
                      </div>
                      <div className="bg-gradient-to-r from-indigo-50/90 via-sky-50/80 to-white p-4 rounded-2xl flex items-center gap-3 border border-indigo-150/70 shadow-sm">
                        <div className="flex gap-1.5 items-center">
                          <span className="w-2 h-2 bg-indigo-500 rounded-full animate-ping" />
                          <span className="w-2 h-2 bg-sky-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                          <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" />
                        </div>
                        <span className="text-[14px] font-bold text-indigo-900 tracking-wide flex items-center gap-1.5">
                          <span className="text-amber-500">👑</span> Gemini AI đang suy luận & tổng hợp số liệu chính xác...
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </ScrollArea>

            {/* Input Area / Smart suggestions overlay */}
            <div className="p-4 border-t border-slate-100 bg-white space-y-3">
              
              {/* Dynamic suggestion chips */}
              <div className="max-w-4xl mx-auto flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none">
                <span className="text-[13px] font-black uppercase text-indigo-600 shrink-0 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-100/50 flex items-center gap-1 shadow-xs">
                  <Sparkles size={11} className="text-indigo-600 animate-pulse" /> GỢI Ý NHANH:
                </span>
                <SuggestionChip 
                  label="⚠️ Cảnh Báo & Rủi Ro Chủ Động" 
                  onClick={() => handleSendMessage(undefined, "Hãy thực hiện một buổi 'Phân tích Chủ động & Cảnh báo Sớm' trên toàn bộ dữ liệu đã nạp. Hãy rà soát và phát hiện toàn bộ các rủi ro vận hành sau đây: 1. Các đơn hàng bị trùng lặp hoàn toàn về giá trị, ngày, sản phẩm và khách hàng. 2. Các dòng dữ liệu bất thường hoặc không hợp lệ (ví dụ số lượng âm hoặc giá bán bằng không). 3. Các cảnh báo tồn kho đỏ (các sản phẩm có tồn kho thực tế dưới 5 chiếc). 4. Các điểm sụt giảm doanh số nghiêm trọng giữa các tháng (giảm >30% MoM). Hãy liệt kê rõ ràng từng lỗi hoặc rủi ro theo dạng Bảng Cảnh báo chuyên nghiệp kèm theo đề xuất xử lý sắc sảo, chỉ rõ nguồn gốc dữ liệu đến từng dòng Excel cụ thể của tệp dữ liệu nguồn.")} 
                />
                <SuggestionChip 
                  label="📝 Tổng hợp Báo cáo Tháng" 
                  onClick={() => handleSendMessage(undefined, "Hãy tổng hợp dữ liệu giao dịch gần đây và tạo một báo cáo tóm tắt hiệu quả kinh doanh, doanh số và các điểm sáng nổi bật trong tháng.")} 
                />
                <SuggestionChip 
                  label="📈 Dự báo Tăng trưởng Quý 4" 
                  onClick={() => handleSendMessage(undefined, "Dựa vào chỉ số doanh thu lịch sử hiện có trong dữ liệu, hãy phân tích dự báo xu hướng tăng trưởng doanh số cho Quý 4 sắp tới.")} 
                />
                <SuggestionChip 
                  label="📊 Phân tích Biên Lợi nhuận" 
                  onClick={() => handleSendMessage(undefined, "So sánh tỷ suất biên lợi nhuận ròng giữa các dòng sản phẩm (ví dụ Laptop vs Phụ kiện) và chỉ ra nhóm hàng tối ưu lợi nhuận nhất.")} 
                />
                <SuggestionChip 
                  label="👑 Tìm Khách hàng VIP" 
                  onClick={() => handleSendMessage(undefined, "Tìm và liệt kê TOP 5 khách hàng tiềm năng đóng góp doanh số tích lũy nhiều nhất trong nguồn dữ liệu hệ thống.")} 
                />
                <SuggestionChip 
                  label="🔍 Kiểm tra Cấu trúc Dữ liệu" 
                  onClick={() => handleSendMessage(undefined, "Hãy mô tả định dạng, các cột dữ liệu hiện tại đang có trong nguồn dữ liệu này.")} 
                />
              </div>

              <form 
                onSubmit={handleSendMessage}
                className="max-w-4xl mx-auto relative flex items-center gap-3 bg-slate-50 p-2 rounded-2xl border border-slate-200 focus-within:border-indigo-400 transition-all shadow-inner"
              >
                <div className="p-2 text-slate-400 hover:text-indigo-600 cursor-pointer transition-colors shrink-0">
                  <Paperclip size={20} />
                </div>
                
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Đặt câu hỏi phân tích, xu hướng hoặc dự đoán cho Sales AI..."
                  className="border-none bg-transparent focus-visible:ring-0 text-[17px] font-medium h-12 flex-1 pt-0 mt-0"
                  disabled={isLoading}
                />
                
                <Button 
                  type="submit" 
                  size="icon" 
                  disabled={!input.trim() || isLoading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl w-10 h-10 shadow-lg shadow-indigo-100 transition-all active:scale-95 shrink-0"
                >
                  <Send size={18} />
                </Button>
              </form>

              {/* Toggles & indicators */}
              <div className="flex flex-wrap justify-between items-center max-w-4xl mx-auto gap-4 py-1">
                <div className="flex gap-4">
                  <span className="text-[13px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-tight">
                    <Sparkles size={10} className="text-amber-500" /> Model: {modelName}
                  </span>
                  <span className="text-[13px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-tight">
                   <Database size={10} className="text-indigo-400" /> Nguồn: {selectedFiles.length} tệp
                  </span>
                </div>

                {/* Interactive Semantic Search Toggler Mode */}
                <button
                  type="button"
                  onClick={() => {
                    setUseVector(p => !p);
                    toast.success(useVector ? "Dịch vụ đã tắt Vector. Ưu tiên Keyword Match nhanh" : "Đã kích hoạt giải thuật truy hồi Semantic Vector Embeddings");
                  }}
                  className="text-[13px] font-black text-indigo-600 hover:underline flex items-center gap-1 uppercase tracking-tight bg-indigo-50/50 px-2 py-1 rounded-md border border-indigo-100"
                >
                  <Sliders size={10} className="text-indigo-500" /> 
                  Hệ thống: {useVector ? "Semantic Vector Search" : "Keyword Matching fallback"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* RAG Debugger Side-panel */}
      {showRagDebugger && (
        <aside className="hidden xl:flex flex-col w-[380px] bg-white border border-sky-100/50 shadow-md shadow-sky-500/5 rounded-3xl overflow-hidden animate-fade-in shrink-0">
          <div className="p-4.5 bg-gradient-to-r from-sky-50/50 to-transparent border-b border-sky-100/30 flex items-center justify-between shrink-0">
            <h3 className="text-[15px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <Sliders size={14} className="text-indigo-500" /> Kính lúp RAG - Pipeline Analyzer
            </h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowRagDebugger(false)}
              className="w-6 h-6 rounded-md text-slate-400 hover:text-slate-600 border-none"
            >
              <X size={14} />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-5 space-y-5 text-left">
              
              {/* Parameter Settings */}
              <div className="space-y-3.5">
                <h4 className="text-[15px] font-black uppercase text-indigo-600 tracking-wider flex items-center gap-1">
                  <Sliders size={12} /> Cấu hình tham số RAG live
                </h4>
                <div className="p-4 bg-slate-50/50 border border-slate-100 rounded-2xl space-y-4">
                  {/* Top-K Slider */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[15px] font-bold text-slate-700">
                      <span>Top-K (Số mảnh lấy ra):</span>
                      <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md font-mono">{topK}</span>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="10" 
                      value={topK}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setTopK(val);
                        toast.info(`Đã điều chỉnh Top-K về ${val}`);
                      }}
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                    <span className="text-[13px] text-slate-400 leading-tight block">
                      Số lượng các đoạn dữ liệu tương đồng cao nhất lấy ra làm ngữ cảnh cho LLM.
                    </span>
                  </div>

                  {/* Similarity Threshold Slider */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[15px] font-bold text-slate-700">
                      <span>Ngưỡng lọc tương đồng:</span>
                      <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md font-mono">{(threshold * 100).toFixed(0)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.10" 
                      max="0.90" 
                      step="0.05"
                      value={threshold}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setThreshold(val);
                        toast.info(`Đã điều chỉnh ngưỡng tương đồng về ${(val * 100).toFixed(0)}%`);
                      }}
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                    <span className="text-[13px] text-slate-400 leading-tight block">
                      Bỏ qua các phân mảnh có điểm tương đồng cosine thấp hơn ngưỡng này.
                    </span>
                  </div>
                </div>
              </div>

              {/* Vector Details */}
              <div className="space-y-3.5">
                <h4 className="text-[15px] font-black uppercase text-indigo-600 tracking-wider flex items-center gap-1">
                  <Database size={12} /> Vector hóa truy vấn
                </h4>
                {lastRagDetails ? (
                  <div className="p-4 bg-slate-50/50 border border-slate-100 rounded-2xl space-y-2">
                    <div className="text-[15px] font-bold text-slate-700 leading-relaxed">
                      <span className="text-slate-400 font-medium">Query:</span> "{lastRagDetails.queryText}"
                    </div>
                    <div className="space-y-1 pt-1 border-t border-slate-100">
                      <div className="flex justify-between text-[13px] font-bold text-slate-400 uppercase tracking-tight">
                        <span>Embedding Vector:</span>
                        <span className="text-indigo-600">{lastRagDetails.queryVector ? `${lastRagDetails.queryVector.length} dims (Gemini)` : "None"}</span>
                      </div>
                      {lastRagDetails.queryVector && (
                        <div className="bg-slate-900 text-emerald-400 p-2.5 rounded-xl font-mono text-[12px] break-all leading-normal max-h-20 overflow-y-auto border border-slate-800">
                          [{lastRagDetails.queryVector.slice(0, 16).map(v => v.toFixed(5)).join(', ')}, ...]
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 border border-dashed border-slate-200 rounded-2xl text-center">
                    <p className="text-[15px] font-medium text-slate-400 italic">Chưa thực hiện truy vấn RAG nào. Hãy gửi tin nhắn để phân tích vector.</p>
                  </div>
                )}
              </div>

              {/* Chunks retrieved & score mapping */}
              <div className="space-y-3.5">
                <h4 className="text-[15px] font-black uppercase text-indigo-600 tracking-wider flex items-center gap-1">
                  <Layers size={12} /> Các phân mảnh truy xuất (Top-K Chunks)
                </h4>
                {lastRagDetails && lastRagDetails.citations && lastRagDetails.citations.length > 0 ? (
                  <div className="space-y-3">
                    {lastRagDetails.citations.map((cit, idx) => {
                      const isApproved = cit.score >= threshold;
                      return (
                        <div key={idx} className={cn(
                          "p-3.5 border rounded-2xl space-y-2 transition-all text-[15px]",
                          isApproved 
                            ? "bg-emerald-50/20 border-emerald-100/60" 
                            : "bg-rose-50/10 border-rose-100/30 opacity-60"
                        )}>
                          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
                            <span className="font-bold text-slate-700 truncate max-w-[140px] block" title={cit.fileName}>
                              📄 {cit.fileName}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-mono font-black text-indigo-600">{(cit.score * 100).toFixed(1)}%</span>
                              <span className={cn(
                                "text-[12px] font-black uppercase px-1.5 py-0.5 rounded-md",
                                isApproved ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                              )}>
                                {isApproved ? "Đạt" : "Loại"}
                              </span>
                            </div>
                          </div>
                          <div className="text-[14px] text-slate-600 leading-relaxed bg-white/60 p-2.5 rounded-xl border border-slate-50 font-medium max-h-24 overflow-y-auto block whitespace-pre-wrap">
                            {cit.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-6 border border-dashed border-slate-200 rounded-2xl text-center">
                    <p className="text-[15px] font-medium text-slate-400 italic">Chưa có kết quả truy xuất phân mảnh nào.</p>
                  </div>
                )}
              </div>

              {/* System Instruction injected */}
              <div className="space-y-3.5">
                <h4 className="text-[15px] font-black uppercase text-indigo-600 tracking-wider flex items-center gap-1">
                  <Bot size={12} /> Prompt Context gửi LLM
                </h4>
                {lastRagDetails && lastRagDetails.systemInstruction ? (
                  <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl text-[13px] font-mono text-slate-300 space-y-1.5 leading-normal">
                    <div className="text-[12px] font-black uppercase text-amber-500 tracking-wider border-b border-slate-800 pb-1 flex items-center justify-between">
                      <span>System Instructions / Prompt:</span>
                      <span className="text-slate-500 font-bold">Ký tự: {lastRagDetails.systemInstruction.length}</span>
                    </div>
                    <div className="max-h-40 overflow-y-auto block whitespace-pre-wrap text-left">
                      {lastRagDetails.systemInstruction}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 border border-dashed border-slate-200 rounded-2xl text-center">
                    <p className="text-[15px] font-medium text-slate-400 italic">Chưa có thông tin prompt được cấu tạo.</p>
                  </div>
                )}
              </div>

            </div>
          </ScrollArea>
        </aside>
      )}

      {/* Custom Confirmation Modals for safe deletion inside iframes */}
      <AnimatePresence>
        {deleteConfirmSessionId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteConfirmSessionId(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            
            {/* Modal Content */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden z-10 p-6 space-y-6"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border border-rose-100">
                  <Trash2 size={22} />
                </div>
                <div className="space-y-1.5 flex-1 min-w-0">
                  <h3 className="text-[21px] font-black text-slate-900 leading-tight">Xóa cuộc hội thoại</h3>
                  <p className="text-slate-500 text-[15px] font-medium leading-relaxed">
                    Bạn có chắc chắn muốn xóa cuộc trò chuyện <strong className="text-slate-800 break-all">"{deleteConfirmSessionTitle}"</strong> không? Hành động này không thể hoàn tác.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setDeleteConfirmSessionId(null)}
                  className="rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold px-4 py-2.5 h-auto"
                >
                  Hủy bỏ
                </Button>
                <Button
                  onClick={executeDeleteSession}
                  className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold px-5 py-2.5 h-auto shadow-md shadow-rose-100 active:scale-95 transition-all"
                >
                  Xác nhận xóa
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {clearAllConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setClearAllConfirmOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            
            {/* Modal Content */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden z-10 p-6 space-y-6"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-rose-100 text-rose-700 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border border-rose-200">
                  <Trash2 size={22} />
                </div>
                <div className="space-y-1.5 flex-1 min-w-0">
                  <h3 className="text-[21px] font-black text-slate-900 leading-tight">Dọn sạch toàn bộ lịch sử</h3>
                  <p className="text-slate-500 text-[15px] font-medium leading-relaxed">
                    Bạn có chắc chắn muốn xóa <strong className="text-rose-600">toàn bộ lịch sử hội thoại</strong> không? Tất cả tin nhắn và phân tích sẽ bị xóa vĩnh viễn và không thể khôi phục.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setClearAllConfirmOpen(false)}
                  className="rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold px-4 py-2.5 h-auto"
                >
                  Hủy bỏ
                </Button>
                <Button
                  onClick={executeClearAllSessions}
                  className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold px-5 py-2.5 h-auto shadow-md shadow-rose-100 active:scale-95 transition-all"
                >
                  Xóa tất cả lịch sử
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function QuickAction({ icon: Icon, label, sublabel, onClick }: { icon: any, label: string, sublabel?: string, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex items-center gap-3.5 p-4.5 bg-white border border-slate-150 rounded-2xl hover:border-indigo-300 hover:bg-indigo-50/30 hover:shadow-md transition-all text-left group cursor-pointer"
    >
      <div className="p-3 bg-slate-50 rounded-xl text-slate-400 group-hover:text-indigo-600 group-hover:bg-indigo-100/50 transition-all duration-300 shrink-0">
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <span className="text-[17px] font-black text-slate-800 block group-hover:text-indigo-700 transition-colors">{label}</span>
        {sublabel && <span className="text-[13px] font-bold text-slate-400 block mt-0.5 leading-tight">{sublabel}</span>}
      </div>
    </button>
  );
}

function SuggestionChip({ label, onClick }: { label: string, onClick: () => void }) {
  return (
    <button 
      type="button"
      onClick={onClick}
      className="px-3.5 py-1.5 bg-slate-50 hover:bg-indigo-600 hover:text-white border border-slate-200 text-slate-700 text-[15px] font-bold rounded-xl transition-all whitespace-nowrap active:scale-95 shadow-xs select-none cursor-pointer flex items-center gap-1.5"
    >
      {label}
    </button>
  );
}
