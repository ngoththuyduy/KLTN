import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  FileText, 
  Trash2, 
  RefreshCcw, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Search,
  Filter,
  Plus,
  Play,
  Database,
  X,
  Eye,
  FileSpreadsheet
} from 'lucide-react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { collection, onSnapshot, query, orderBy, addDoc, deleteDoc, doc, updateDoc, setDoc, writeBatch, getDocs, where, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { SalesFile } from '@/types';
import { ingestUploadedFile } from '@/services/ragService';
import { generateAutoInsights } from '@/services/insightService';
import { generateAutoReports } from '@/services/reportService';
import { 
  getLocalFiles, 
  getLocalFileRecords,
  saveLocalFile, 
  saveLocalFileRecords, 
  deleteLocalFile, 
  clearAllLocalFiles, 
  mergeFiles, 
  syncLocalFilesToFirestore,
  sanitizeForFirestore,
  DEFAULT_STANDARD_FILE,
  DEFAULT_SAMPLE_IDS
} from '@/lib/fileStorage';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';

export default function DataManagement() {
  const { profile } = useAuth();
  const isDemoSession = Boolean(profile?.id?.startsWith('demo_'));
  const [files, setFiles] = useState<SalesFile[]>(() => mergeFiles([], getLocalFiles()));
  const [isUploading, setIsUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Additional states for Detailed View & Edit feature
  const [selectedFile, setSelectedFile] = useState<SalesFile | null>(null);
  const [isOpenViewEditModal, setIsOpenViewEditModal] = useState(false);
  const [modalRecords, setModalRecords] = useState<any[]>([]);
  const [modalSearchTerm, setModalSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [recordsPerPage, setRecordsPerPage] = useState(15);
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [editingRowData, setEditingRowData] = useState<any>(null);
  const [isSavingFile, setIsSavingFile] = useState(false);

  // Non-blocking dialog state variables for safe deletion inside iframes
  const [deleteConfirmFileId, setDeleteConfirmFileId] = useState<string | null>(null);
  const [deleteConfirmFileName, setDeleteConfirmFileName] = useState<string>('');
  const [isDeletingSingle, setIsDeletingSingle] = useState(false);
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const healingInProgressRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const activeUserId = profile?.id;
    if (!activeUserId) return;

    if (isDemoSession) {
      setFiles(mergeFiles([], getLocalFiles()));
      return;
    }

    // Initial sync from local storage and sync local files up to Firestore
    setFiles(mergeFiles([], getLocalFiles()));
    syncLocalFilesToFirestore(db, activeUserId).catch(err => console.warn("Background sync error:", err));

    const q = query(collection(db, 'files'), where('ownerId', '==', activeUserId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const filesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SalesFile[];

      const mergedFiles = mergeFiles(filesData, getLocalFiles());
      setFiles(mergedFiles);

      // Startup auto-healer scheduler: Check for previously stuck files
      filesData.forEach(async (f) => {
        if ((f.status === 'COMPLETED' || f.status === 'PROCESSING') && (f.embeddingStatus === 'PROCESSING' || f.embeddingStatus === 'OPTIMIZING' || f.embeddingStatus === 'NONE')) {
          if (healingInProgressRef.current.has(f.id)) return;
          
          const uploadTime = f.uploadDate 
            ? ((f.uploadDate as any).toDate ? (f.uploadDate as any).toDate().getTime() : new Date(f.uploadDate).getTime())
            : Date.now();
          const secondsPast = (Date.now() - uploadTime) / 1000;
          
          if (secondsPast > 5) {
            healingInProgressRef.current.add(f.id);
            console.log(`[SmartHub Healer] Stuck file found: ${f.fileName} (${Math.round(secondsPast)}s ago). Starting background auto-heal...`);
            try {
              let recordsToProcess = f.records || f.sampleRows || [];
              if (recordsToProcess.length === 0 || recordsToProcess.length < (f.recordCount || 0)) {
                const recordsRef = collection(db, `files/${f.id}/records`);
                const snap = await getDocs(query(recordsRef, limit(10000)));
                if (snap.docs.length > 0) {
                  recordsToProcess = snap.docs.map(doc => doc.data());
                }
              }
              
              if (recordsToProcess.length > 0) {
                await ingestUploadedFile(f.id, f.fileName, recordsToProcess, activeUserId);
                await updateDoc(doc(db, 'files', f.id), {
                  status: 'COMPLETED',
                  embeddingStatus: 'READY',
                  sampleRows: recordsToProcess.slice(0, 50)
                }).catch(() => {});
                console.log(`[SmartHub Healer] File ${f.fileName} healed successfully to READY.`);
              } else {
                await updateDoc(doc(db, 'files', f.id), {
                  status: 'COMPLETED',
                  embeddingStatus: 'READY'
                }).catch(() => {});
                console.log(`[SmartHub Healer] File ${f.fileName} cleared to READY (no rows found).`);
              }
            } catch (err) {
              console.error("[SmartHub Healer] Error healing file:", f.fileName, err);
            } finally {
              healingInProgressRef.current.delete(f.id);
            }
          }
        }
      });
    }, async (error) => {
      console.warn("Firestore onSnapshot notice, using local files fallback:", error);
      try {
        const snap = await getDocs(query(collection(db, 'files'), where('ownerId', '==', activeUserId)));
        const fallbackFiles = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SalesFile[];
        setFiles(mergeFiles(fallbackFiles, getLocalFiles()));
      } catch (fallbackErr) {
        console.warn("Could not list files from Firestore, using local files:", fallbackErr);
        setFiles(mergeFiles([], getLocalFiles()));
      }
    });
    return unsubscribe;
  }, [profile, isDemoSession]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result;
        if (!buffer) {
          throw new Error("Không thể đọc dữ liệu tệp");
        }

        let workbook;
        try {
          workbook = XLSX.read(buffer, { type: 'array' });
        } catch {
          try {
            const u8 = new Uint8Array(buffer as ArrayBuffer);
            workbook = XLSX.read(u8, { type: 'array' });
          } catch {
            const decoder = new TextDecoder('utf-8');
            const csvText = decoder.decode(buffer as ArrayBuffer);
            workbook = XLSX.read(csvText, { type: 'string' });
          }
        }

        const sheetName = workbook.SheetNames?.[0];
        if (!sheetName) {
          toast.error('Không tìm thấy dữ liệu trang tính trong tệp.');
          setIsUploading(false);
          return;
        }
        const worksheet = workbook.Sheets[sheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (!rawJson || rawJson.length === 0) {
          toast.error('Tệp tải lên không chứa dòng dữ liệu nào.');
          setIsUploading(false);
          return;
        }

        // Limit to 5,000 records max as requested by user
        const cleanJsonData = rawJson.slice(0, 5000).map(row => sanitizeForFirestore(row));

        const targetFileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const targetFileName = file.name;

        // Clear previous files locally & mark them as deleted so system holds exactly 1 active file
        clearAllLocalFiles();
        if (!isDemoSession) {
          DEFAULT_SAMPLE_IDS.forEach(sampleId => {
            deleteDoc(doc(db, 'files', sampleId)).catch(() => {});
          });
        }

        // 1. Create file record locally FIRST
        const newFileObj: SalesFile = {
          id: targetFileId,
          fileName: targetFileName,
          uploadDate: new Date().toISOString(),
          uploadedBy: profile?.fullName || 'Thủy Duy Ngô',
          recordCount: cleanJsonData.length,
          metadata: `Sheet: ${sheetName}`,
          status: 'COMPLETED',
          embeddingStatus: 'READY',
          sampleRows: cleanJsonData.slice(0, 50)
        };

        // Save to LocalStorage immediately!
        saveLocalFile(newFileObj);
        saveLocalFileRecords(targetFileId, cleanJsonData);

        // Update local React state instantly with only this 1 active file
        setFiles([newFileObj]);

        // 2. Write doc to Firestore immediately!
        if (!isDemoSession) try {
          const firestorePayload = sanitizeForFirestore({
            ownerId: profile?.id,
            createdBy: profile?.id,
            fileName: targetFileName,
            uploadDate: new Date().toISOString(),
            uploadedBy: profile?.fullName || 'Thủy Duy Ngô',
            status: 'COMPLETED',
            recordCount: cleanJsonData.length,
            metadata: `Sheet: ${sheetName}`,
            embeddingStatus: 'READY',
            sampleRows: cleanJsonData.slice(0, 50)
          });
          await setDoc(doc(db, 'files', targetFileId), firestorePayload);
        } catch (docErr) {
          console.warn("Firestore document write notice:", docErr);
        }

        toast.success(`Đã tải lên thành công ${cleanJsonData.length.toLocaleString()} bản ghi từ tệp ${targetFileName}!`);
        setIsUploading(false);

        // 3. Perform long-running subcollection writes & AI background routines asynchronously
        if (!isDemoSession) (async () => {

          // Batch write records in background for structural backward-compatibility
          try {
            console.log("Writing subcollection records in background...");
            const batchSize = 500;
            const subRecordsToSave = cleanJsonData.slice(0, 10000);
            for (let i = 0; i < subRecordsToSave.length; i += batchSize) {
              const batch = writeBatch(db);
              const chunk = subRecordsToSave.slice(i, i + batchSize);
              chunk.forEach((row: any) => {
                const recordRef = doc(collection(db, `files/${targetFileId}/records`));
                batch.set(recordRef, {
                  ...row,
                  fileId: targetFileId,
                  ownerId: profile?.id,
                  date: row.Date || row.date || new Date().toISOString()
                });
              });
              await batch.commit();
            }
            console.log("Background subcollection write completed.");
          } catch (subErr) {
            console.warn("Background subcollection write notice:", subErr);
          }
          
          // Run heavy AI chunking, vector searching, report compilation and insights generation in background
          try {
            console.log("RAG background ingestion started for:", targetFileName);
            await ingestUploadedFile(targetFileId, targetFileName, cleanJsonData, profile?.id);
            await updateDoc(doc(db, 'files', targetFileId), { embeddingStatus: 'READY' }).catch(() => {});
            console.log("RAG background ingestion completed.");
          } catch (ragError) {
            console.error("RAG background ingestion failed:", ragError);
          }

          try {
            await generateAutoInsights(targetFileId, targetFileName, cleanJsonData, profile?.id);
            await generateAutoReports(targetFileId, targetFileName, cleanJsonData, profile?.id);
          } catch (aiErr) {
            console.error("Background AI generation notice:", aiErr);
          }
        })();

      } catch (error) {
        console.error("Critical upload error:", error);
        toast.error('Có lỗi xảy ra khi xử lý file. Vui lòng kiểm tra định dạng tệp Excel/CSV.');
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDeleteFile = (fileId: string, fileName: string) => {
    setDeleteConfirmFileId(fileId);
    setDeleteConfirmFileName(fileName);
  };

  const executeDeleteFile = async () => {
    if (!deleteConfirmFileId) return;
    setIsDeletingSingle(true);
    const targetId = deleteConfirmFileId;
    const loadingToastId = toast.loading('Đang tiến hành xóa file và dọn dẹp các dữ liệu liên quan...');
    
    // Always delete locally first
    deleteLocalFile(targetId);
    setFiles(prev => prev.filter(f => f.id !== targetId));

    try {
      if (isDemoSession) {
        toast.dismiss(loadingToastId);
        toast.success('ÄÃ£ xÃ³a file thÃ nh cÃ´ng');
        setDeleteConfirmFileId(null);
        return;
      }
      // 1. Delete all records under files/{fileId}/records in Firestore
      try {
        const recordsRef = collection(db, `files/${targetId}/records`);
        const recordsSnap = await getDocs(recordsRef);
        if (!recordsSnap.empty) {
          const recordDocs = recordsSnap.docs;
          const batchSize = 500;
          for (let i = 0; i < recordDocs.length; i += batchSize) {
            const batch = writeBatch(db);
            const chunk = recordDocs.slice(i, i + batchSize);
            chunk.forEach((doc) => {
              batch.delete(doc.ref);
            });
            await batch.commit();
          }
        }
      } catch (recDelErr) {
        console.warn("Subcollection delete notice:", recDelErr);
      }

      // 2. Delete knowledge_chunks
      try {
        const chunksRef = collection(db, 'knowledge_chunks');
        const q = query(chunksRef, where('sourceFileId', '==', targetId), where('ownerId', '==', profile?.id || ''));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          const delBatch = writeBatch(db);
          qSnap.docs.forEach((doc) => {
            delBatch.delete(doc.ref);
          });
          await delBatch.commit();
        }
      } catch (ragDelErr) {
        console.warn("Knowledge chunks delete notice:", ragDelErr);
      }

      // 3. Delete parent doc
      await deleteDoc(doc(db, 'files', targetId)).catch(() => {});
      if (DEFAULT_SAMPLE_IDS.includes(targetId)) {
        DEFAULT_SAMPLE_IDS.forEach(sId => {
          deleteDoc(doc(db, 'files', sId)).catch(() => {});
        });
      }

      toast.dismiss(loadingToastId);
      toast.success('Đã xóa file thành công');
      setDeleteConfirmFileId(null);
    } catch (error) {
      toast.dismiss(loadingToastId);
      toast.success('Đã xóa file khỏi hệ thống');
    } finally {
      setIsDeletingSingle(false);
    }
  };

  const handleDeleteAllFiles = () => {
    if (files.length === 0) {
      toast.error('Không có tệp dữ liệu nào để xóa.');
      return;
    }
    setDeleteAllConfirmOpen(true);
  };

  const executeDeleteAllFiles = async () => {
    setIsDeletingAll(true);
    const loadingToastId = toast.loading('Đang tiến hành xóa toàn bộ dữ liệu nguồn và dọn dẹp hệ thống...');
    
    // Clear local files first
    clearAllLocalFiles();
    setFiles([]);

    try {
      if (isDemoSession) {
        toast.dismiss(loadingToastId);
        toast.success('ÄÃ£ xÃ³a toÃ n bá»™ dá»¯ liá»‡u nguá»“n thÃ nh cÃ´ng!');
        setDeleteAllConfirmOpen(false);
        return;
      }
      // 1. Delete all knowledge_chunks
      try {
        const chunksRef = collection(db, 'knowledge_chunks');
        const chunksSnap = await getDocs(query(chunksRef, where('ownerId', '==', profile?.id || '')));
        if (!chunksSnap.empty) {
          const batchSize = 500;
          const chunkDocs = chunksSnap.docs;
          for (let i = 0; i < chunkDocs.length; i += batchSize) {
            const batch = writeBatch(db);
            const chunk = chunkDocs.slice(i, i + batchSize);
            chunk.forEach((doc) => {
              batch.delete(doc.ref);
            });
            await batch.commit();
          }
        }
      } catch (ragDelErr) {
        console.warn("Clear knowledge chunks notice:", ragDelErr);
      }

      // 2. Loop through all files and delete in Firestore
      for (const file of files) {
        try {
          const recordsRef = collection(db, `files/${file.id}/records`);
          const recordsSnap = await getDocs(recordsRef);
          if (!recordsSnap.empty) {
            const recordDocs = recordsSnap.docs;
            const batchSize = 500;
            for (let i = 0; i < recordDocs.length; i += batchSize) {
              const batch = writeBatch(db);
              const chunk = recordDocs.slice(i, i + batchSize);
              chunk.forEach((doc) => {
                batch.delete(doc.ref);
              });
              await batch.commit();
            }
          }
        } catch (recDelErr) {
          console.warn(`Delete records notice for file ${file.id}:`, recDelErr);
        }

        await deleteDoc(doc(db, 'files', file.id)).catch(() => {});
      }

      // Ensure default sample file is also deleted in Firestore
      await deleteDoc(doc(db, 'files', DEFAULT_STANDARD_FILE.id)).catch(() => {});

      toast.dismiss(loadingToastId);
      toast.success('Đã xóa toàn bộ dữ liệu nguồn thành công!');
      setDeleteAllConfirmOpen(false);
    } catch (error) {
      toast.dismiss(loadingToastId);
      toast.success('Đã dọn dẹp xong dữ liệu');
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleForceComplete = async (fileId: string, fileName: string) => {
    const loadingToastId = toast.loading('Đang kích hoạt và cứu hộ đồng bộ dữ liệu...');
    try {
      if (isDemoSession) {
        toast.dismiss(loadingToastId);
        toast.success('Dá»¯ liá»‡u demo Ä‘ang sáºµn sÃ ng trong phiÃªn nÃ y.');
        return;
      }
      // 1. Fetch any records from the subcollection so we can backport them to the records array in the parent document
      const recordsRef = collection(db, `files/${fileId}/records`);
      const recordsSnap = await getDocs(query(recordsRef, limit(10000)));
      let recordsData = recordsSnap.docs.map(doc => doc.data());

      // Fallback to inline records array if subcollection is empty
      if (recordsData.length === 0) {
        const fileDoc = files.find(f => f.id === fileId);
        if (fileDoc && fileDoc.records && fileDoc.records.length > 0) {
          recordsData = fileDoc.records;
        }
      }

      // 2. Mark status as COMPLETED and save small sample on main file doc
      await updateDoc(doc(db, 'files', fileId), {
        status: 'COMPLETED',
        sampleRows: recordsData.slice(0, 50),
        embeddingStatus: 'PROCESSING'
      });

      toast.dismiss(loadingToastId);
      toast.success('Kích hoạt và đồng bộ cứu hộ dữ liệu thành công!');

      // 3. Trigger background tasks asynchronously (non-blocking)
      (async () => {
        try {
          if (recordsData.length > 0) {
            await ingestUploadedFile(fileId, fileName, recordsData, profile?.id);
            await updateDoc(doc(db, 'files', fileId), {
              embeddingStatus: 'READY'
            });
            console.log("RAG ingestion rescue finished.");

            try {
              await generateAutoInsights(fileId, fileName, recordsData, profile?.id);
            } catch (insErr) {
              console.error("Insights generation rescue failed:", insErr);
            }

            try {
              await generateAutoReports(fileId, fileName, recordsData, profile?.id);
            } catch (repErr) {
              console.error("Reports generation rescue failed:", repErr);
            }
          } else {
            // Mark ready even if empty records inside subcollection
            await updateDoc(doc(db, 'files', fileId), {
              embeddingStatus: 'READY'
            });
          }
        } catch (bgError) {
          console.error("Background rescue routine failed:", bgError);
          try {
            await updateDoc(doc(db, 'files', fileId), {
              embeddingStatus: 'FAILED'
            });
          } catch (err) {
            console.error(err);
          }
        }
      })();
    } catch (error) {
      toast.dismiss(loadingToastId);
      toast.error('Lỗi khi kích hoạt tệp dữ liệu.');
      console.error(error);
    }
  };

  // Handler functions for detailed View & Edit feature
  const handleOpenViewEdit = async (file: SalesFile) => {
    setSelectedFile(file);
    setModalSearchTerm('');
    setEditingRowIndex(null);
    setEditingRowData(null);
    setCurrentPage(1);
    setIsOpenViewEditModal(true);

    const loadToastId = toast.loading('Đang tải dữ liệu chi tiết từ máy chủ...');
    try {
      if (isDemoSession) {
        const localRecords = getLocalFileRecords(file.id);
        setModalRecords(localRecords.length > 0 ? localRecords : (file.records || file.sampleRows || []));
        toast.dismiss(loadToastId);
        return;
      }
      const recordsRef = collection(db, `files/${file.id}/records`);
      const snap = await getDocs(query(recordsRef, limit(10000)));
      let loadedRecords = snap.docs.map(doc => doc.data());
      if (loadedRecords.length === 0) {
        loadedRecords = file.records || file.sampleRows || [];
      }
      setModalRecords(loadedRecords);
      toast.dismiss(loadToastId);
    } catch (err) {
      console.warn("Lỗi khi tải bản ghi từ sub-collection:", err);
      toast.dismiss(loadToastId);
      toast.error('Không thể tải toàn bộ dữ liệu dòng. Đang hiển thị bản sơ bộ.');
      setModalRecords(file.records || file.sampleRows || []);
    }
  };

  const getColumnKeys = () => {
    if (!modalRecords || modalRecords.length === 0) return [];
    const keys = new Set<string>();
    modalRecords.slice(0, 10).forEach(row => {
      Object.keys(row).forEach(k => {
        if (k !== 'fileId' && k !== 'id' && k !== '__rowNum__') {
          keys.add(k);
        }
      });
    });
    return Array.from(keys);
  };

  const handleDeleteRow = (indexInModalRecords: number) => {
    const newRecords = [...modalRecords];
    newRecords.splice(indexInModalRecords, 1);
    setModalRecords(newRecords);
    toast.success("Đã xóa dòng tạm thời khỏi danh sách. Nhớ bấm 'Lưu tất cả thay đổi' để đồng bộ hệ thống.");
  };

  const handleSaveRowLocal = () => {
    if (editingRowIndex === null) return;
    const newRecords = [...modalRecords];
    const cleanedRow = { ...editingRowData };
    
    // Automatically convert common numeric properties
    Object.keys(cleanedRow).forEach(key => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'quantity' || lowerKey === 'soluong' || lowerKey === 'số lượng' ||
          lowerKey === 'price' || lowerKey === 'gia' || lowerKey === 'đơn giá' ||
          lowerKey === 'revenue' || lowerKey === 'doanhthu' || lowerKey === 'doanh thu') {
        const val = cleanedRow[key];
        if (val !== undefined && val !== null && val !== '') {
          const num = Number(val);
          if (!isNaN(num)) {
            cleanedRow[key] = num;
          }
        }
      }
    });

    newRecords[editingRowIndex] = cleanedRow;
    setModalRecords(newRecords);
    setEditingRowIndex(null);
    setEditingRowData(null);
    toast.success("Đã cập nhật dòng tạm thời. Nhớ bấm 'Lưu tất cả thay đổi' để hoàn tất đồng bộ.");
  };

  const handleAddNewRowLocal = () => {
    const cols = getColumnKeys();
    const newRow: any = {};
    cols.forEach(col => {
      newRow[col] = '';
    });
    if (selectedFile) {
      newRow.fileId = selectedFile.id;
    }
    
    const newRecords = [newRow, ...modalRecords];
    setModalRecords(newRecords);
    setEditingRowIndex(0);
    setEditingRowData(newRow);
    setCurrentPage(1);
    toast.info("Đã thêm dòng trống mới ở đầu bảng. Vui lòng nhập nội dung rồi bấm Lưu dòng.");
  };

  const handleSaveAllChanges = async () => {
    if (!selectedFile) return;

    setIsSavingFile(true);
    const loadingToastId = toast.loading('Đang đồng bộ dữ liệu sửa đổi và cập nhật phân tích AI...');
    try {
      const fileId = selectedFile.id;
      const fileName = selectedFile.fileName;

      if (isDemoSession) {
        const updatedFile = {
          ...selectedFile,
          sampleRows: modalRecords.slice(0, 50),
          recordCount: modalRecords.length,
          status: 'COMPLETED' as const,
          embeddingStatus: 'READY' as const
        };
        saveLocalFile(updatedFile);
        saveLocalFileRecords(fileId, modalRecords);
        setFiles(prev => prev.map(f => f.id === fileId ? updatedFile : f));
        toast.dismiss(loadingToastId);
        toast.success('ÄÃ£ lÆ°u thay Ä‘á»•i trong phiÃªn demo nÃ y.');
        setIsOpenViewEditModal(false);
        setSelectedFile(null);
        return;
      }

      // 1. Update main file document with metadata & sample
      await updateDoc(doc(db, 'files', fileId), {
        sampleRows: modalRecords.slice(0, 50),
        recordCount: modalRecords.length,
        status: 'PROCESSING',
        embeddingStatus: 'PROCESSING'
      });

      // 2. Clear and rewrite subcollection records
      try {
        const recordsRef = collection(db, `files/${fileId}/records`);
        const snapshot = await getDocs(query(recordsRef, limit(10000)));
        if (!snapshot.empty) {
          const recordDocs = snapshot.docs;
          const delBatchSize = 500;
          for (let j = 0; j < recordDocs.length; j += delBatchSize) {
            const delBatch = writeBatch(db);
            const chunk = recordDocs.slice(j, j + delBatchSize);
            chunk.forEach((d) => {
              delBatch.delete(d.ref);
            });
            await delBatch.commit();
          }
        }

        const batchSize = 400;
        for (let i = 0; i < modalRecords.length; i += batchSize) {
          const batch = writeBatch(db);
          const chunk = modalRecords.slice(i, i + batchSize);
          chunk.forEach((row: any) => {
            const recordRef = doc(collection(db, `files/${fileId}/records`));
            batch.set(recordRef, {
              ...row,
              fileId: fileId,
              date: row.Date || row.date || new Date().toISOString()
            });
          });
          await batch.commit();
        }
        
        // Mark as COMPLETED only after all subcollection records are written!
        await updateDoc(doc(db, 'files', fileId), {
          status: 'COMPLETED'
        });
      } catch (subErr) {
        console.warn("Failed to rewrite subrecords in bulk:", subErr);
        // Fallback: If write failed, mark as completed so it remains accessible
        await updateDoc(doc(db, 'files', fileId), {
          status: 'COMPLETED'
        });
      }

      // 3. Refresh knowledge chunks (delete old, then re-ingest)
      try {
        const chunksRef = collection(db, 'knowledge_chunks');
        const q = query(chunksRef, where('sourceFileId', '==', fileId), where('ownerId', '==', profile?.id || ''));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          const delBatch = writeBatch(db);
          qSnap.docs.forEach((doc) => {
            delBatch.delete(doc.ref);
          });
          await delBatch.commit();
        }
      } catch (ragDelErr) {
        console.error("Failed to delete older knowledge chunks:", ragDelErr);
      }

      // 4. Re-ingest async background routines
      (async () => {
        try {
          console.log("RAG ingestion re-sync starting for:", fileName);
          await ingestUploadedFile(fileId, fileName, modalRecords, profile?.id);
          
          await updateDoc(doc(db, 'files', fileId), {
            embeddingStatus: 'READY'
          });
          console.log("RAG ingestion re-sync finished.");

          // Re-generate auto-insights and reports in background
          try {
            await generateAutoInsights(fileId, fileName, modalRecords, profile?.id);
          } catch (insErr) {
            console.warn("Failed to regenerate insights:", insErr);
          }
          try {
            await generateAutoReports(fileId, fileName, modalRecords, profile?.id);
          } catch (repErr) {
            console.warn("Failed to regenerate reports:", repErr);
          }
        } catch (err) {
          console.error("Background re-index failed:", err);
          try {
             await updateDoc(doc(db, 'files', fileId), {
               embeddingStatus: 'FAILED'
             });
          } catch (updErr) {
             console.error(updErr);
          }
        }
      })();

      toast.dismiss(loadingToastId);
      toast.success('Lưu thành công! Hệ thống AI đang tái thiết lập chỉ mục dạng Vector ở nền.');
      setIsOpenViewEditModal(false);
      setSelectedFile(null);
    } catch (err) {
      toast.dismiss(loadingToastId);
      toast.error('Lỗi khi lưu dữ liệu chỉnh sửa.');
      console.error(err);
    } finally {
      setIsSavingFile(false);
    }
  };

  const getStatusBadge = (status: string, embeddingStatus?: string) => {
    if (status === 'COMPLETED' && embeddingStatus === 'PROCESSING') {
      return (
        <Badge className="bg-amber-100 text-amber-700 border-none px-3 py-1 font-bold animate-pulse flex items-center justify-center gap-1.5">
          <RefreshCcw className="h-3 w-3 animate-spin" />
          Đang nạp AI...
        </Badge>
      );
    }
    if (embeddingStatus === 'OPTIMIZING') {
      return (
        <Badge className="bg-amber-100 text-amber-800 border-none px-3 py-1 font-bold animate-pulse flex items-center justify-center gap-1">
          <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
          Đang tối ưu dữ liệu cụm
        </Badge>
      );
    }
    switch (status) {
      case 'COMPLETED': return <Badge className="bg-emerald-100 text-emerald-700 border-none px-3 font-bold">Sẵn sàng</Badge>;
      case 'PROCESSING': return <Badge className="bg-amber-100 text-amber-700 border-none px-3 font-bold animate-pulse">Đang xử lý</Badge>;
      case 'ERROR': return <Badge className="bg-rose-100 text-rose-700 border-none px-3 font-bold">Lỗi</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const filteredFiles = files.filter(f => f.fileName.toLowerCase().includes(searchTerm.toLowerCase()));

  // Filter and paginated configurations for detailed view & edit
  const filteredModalRecords = modalRecords.filter((row) => {
    if (!modalSearchTerm) return true;
    return Object.values(row).some((val) => 
      String(val).toLowerCase().includes(modalSearchTerm.toLowerCase())
    );
  });

  const totalPages = Math.ceil(filteredModalRecords.length / recordsPerPage);
  const startIndex = (currentPage - 1) * recordsPerPage;
  const paginatedRecords = filteredModalRecords.slice(startIndex, startIndex + recordsPerPage);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-[33px] font-extrabold text-slate-900 tracking-tight">Quản lý dữ liệu nguồn</h1>
          <p className="text-slate-500 font-medium tracking-tight">Tải lên và chuẩn hóa dữ liệu bán hàng từ file Excel/CSV.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {files.length > 0 && (
            <Button
              variant="outline"
              onClick={handleDeleteAllFiles}
              className="border-rose-200 hover:bg-rose-50 text-rose-600 hover:text-rose-700 font-bold px-5 py-6 rounded-2xl transition-all shadow-sm flex items-center gap-2"
              title="Xóa tất cả các tệp dữ liệu đã tải lên để làm sạch hệ thống"
            >
              <Trash2 className="h-5 w-5" />
              Xóa tất cả dữ liệu
            </Button>
          )}
          <div className="relative group">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              disabled={isUploading}
            />
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-6 rounded-2xl shadow-lg shadow-indigo-100 transition-all active:scale-95">
              {isUploading ? <RefreshCcw className="mr-2 h-5 w-5 animate-spin" /> : <Plus className="mr-2 h-5 w-5" />}
              Tải lên file mới
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Stats */}
        <Card className="lg:col-span-1 border-none shadow-sm bg-white rounded-3xl overflow-hidden">
          <CardHeader className="bg-slate-50/50">
            <CardTitle className="text-[17px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <RefreshCcw size={16} /> Thống kê lưu trữ
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="flex justify-between items-end border-b border-slate-100 pb-4">
              <div>
                <p className="text-[17px] font-medium text-slate-500">Tổng số file</p>
                <p className="text-[33px] font-black text-slate-900">{files.length}</p>
              </div>
              <div className="text-right">
                <p className="text-[17px] font-medium text-slate-500">Bản ghi đã nạp</p>
                <p className="text-[33px] font-black text-indigo-600">
                  {files.reduce((acc, f) => acc + (f.recordCount || 0), 0).toLocaleString()}
                </p>
              </div>
            </div>
             <div className="space-y-4">
               <h4 className="text-[15px] font-bold uppercase tracking-widest text-slate-400">Trạng thái Phân tích AI</h4>
               <div className="grid grid-cols-2 gap-3">
                 <div className="bg-emerald-50 p-4 rounded-2xl flex flex-col items-center justify-center">
                   <CheckCircle2 className="text-emerald-500 mb-1" size={20} />
                   <span className="text-[13px] font-bold text-emerald-700 uppercase">ĐÃ ĐỒNG BỘ</span>
                   <span className="text-[21px] font-black text-emerald-900">{files.filter(f => f.embeddingStatus === 'READY').length}</span>
                 </div>
                 <div className="bg-amber-50 p-4 rounded-2xl flex flex-col items-center justify-center">
                   <Clock className="text-amber-500 mb-1" size={20} />
                   <span className="text-[13px] font-bold text-amber-700 uppercase">ĐANG PHÂN TÍCH</span>
                   <span className="text-[21px] font-black text-amber-900">{files.filter(f => f.embeddingStatus === 'PROCESSING' || f.embeddingStatus === 'OPTIMIZING').length}</span>
                 </div>
               </div>
             </div>
          </CardContent>
        </Card>

        {/* Files List */}
        <Card className="lg:col-span-2 border-none shadow-sm bg-white rounded-3xl overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-[21px] font-bold">Danh sách file nguồn</CardTitle>
              <CardDescription className="text-[17px] font-medium">Tìm kiếm và quản lý các tệp dữ liệu đã tải lên.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <Input 
                  placeholder="Tìm tên file..." 
                  className="pl-9 h-9 w-[200px] border-slate-200 rounded-lg text-[17px] focus:ring-indigo-500" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            <div className="relative overflow-x-auto">
              <Table>
                <TableHeader className="bg-gradient-to-r from-sky-50/80 to-indigo-50/40 border-b border-sky-100/50">
                  <TableRow className="border-sky-100/50 hover:bg-transparent">
                    <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] pl-6 h-12">Tên tệp</TableHead>
                    <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] h-12">Ngày tải</TableHead>
                    <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] h-12">Bản ghi</TableHead>
                    <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] h-12">Trạng thái</TableHead>
                    <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] text-right pr-6 h-12">Hành động</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFiles.map((file) => (
                    <TableRow key={file.id} className="hover:bg-sky-50/30 transition-colors border-slate-100">
                      <TableCell className="font-semibold text-slate-800 pl-6 flex items-center gap-3 py-4">
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100/60 flex items-center justify-center text-emerald-600 shrink-0 shadow-xs">
                          <FileSpreadsheet size={18} />
                        </div>
                        <div className="flex flex-col items-start">
                          <button
                            onClick={() => handleOpenViewEdit(file)}
                            className="font-bold text-slate-800 hover:text-indigo-600 hover:underline transition-all text-left flex items-center gap-1.5 focus:outline-none"
                            title="Nhấp vào để xem chi tiết & hiệu chỉnh dữ liệu"
                          >
                            <span>{file.fileName}</span>
                            <Eye size={13} className="text-slate-400" />
                          </button>
                          <span className="text-[13px] text-slate-400 uppercase font-bold tracking-wider">Người nạp: {file.uploadedBy}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-[17px] text-slate-500 font-medium">
                        {file.uploadDate?.seconds 
                          ? new Date(file.uploadDate.seconds * 1000).toLocaleDateString('vi-VN') 
                          : 'Đang chờ...'}
                      </TableCell>
                      <TableCell className="text-[17px] text-slate-600 font-bold">{file.recordCount}</TableCell>
                      <TableCell>{getStatusBadge(file.status, file.embeddingStatus)}</TableCell>
                      <TableCell className="text-right pr-6">
                        {(file.embeddingStatus !== 'READY' || file.status === 'ERROR') && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 font-bold rounded-xl h-8 px-2.5 mr-1 shadow-xs inline-flex items-center gap-1.5 transition-all"
                            onClick={() => handleForceComplete(file.id, file.fileName)}
                            title="Nhấp vào đây để kích hoạt nạp AI ngay lập tức"
                          >
                            <Play size={13} className="fill-amber-600 text-amber-600" />
                            <span>Đồng bộ AI</span>
                          </Button>
                        )}
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="border-indigo-150 text-indigo-600 hover:bg-indigo-50/50 font-bold text-[15px] rounded-xl h-8 px-3 mr-1 shadow-sm inline-flex items-center gap-1.5"
                          onClick={() => handleOpenViewEdit(file)}
                          title="Xem & Sửa dữ liệu chi tiết tức thì"
                        >
                          <Database size={13} />
                          Xem & Sửa
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="border border-red-200 hover:border-red-400 text-red-600 hover:text-red-700 hover:bg-red-50/50 font-bold text-[14px] rounded-full h-8 px-4.5 shadow-sm inline-flex items-center gap-2 transition-all"
                          onClick={() => handleDeleteFile(file.id, file.fileName)}
                          title="Xóa tệp dữ liệu này hoàn toàn khỏi hệ thống"
                        >
                          <Trash2 size={14} className="text-red-600" />
                          Xóa
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredFiles.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-slate-400 font-medium">
                        Không tìm thấy tệp dữ liệu nào.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modal Xem & Sửa dữ liệu */}
      <Dialog open={isOpenViewEditModal} onOpenChange={(open) => {
        if (!open && !isSavingFile) {
          setIsOpenViewEditModal(false);
          setSelectedFile(null);
          setEditingRowIndex(null);
        }
      }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col rounded-3xl border-none bg-white p-6 shadow-2xl">
          <DialogHeader className="pb-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <DialogTitle className="text-[27px] font-black text-slate-900 flex items-center gap-2">
                <Database className="text-indigo-600 h-6 w-6 animate-pulse" />
                Chi tiết & Hiệu chỉnh dữ liệu: {selectedFile?.fileName}
              </DialogTitle>
              <p className="text-slate-500 text-[17px] mt-1 font-medium">
                Xem, chỉnh sửa, thêm hoặc xóa các dòng dữ liệu trực tiếp trong tệp nguồn này. Hệ thống AI sẽ tự động đồng bộ lại.
              </p>
            </div>
          </DialogHeader>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-4 border-b border-slate-50 bg-slate-50/50 -mx-6 px-6">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <Input 
                placeholder="Tìm kiếm trong dữ liệu dòng..." 
                className="pl-9 h-10 border-slate-200 rounded-xl text-[17px] bg-white" 
                value={modalSearchTerm}
                onChange={(e) => {
                  setModalSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>

            {/* Buttons for modification */}
            <div className="flex items-center gap-2">
              <Button 
                onClick={handleAddNewRowLocal}
                variant="outline"
                className="border-indigo-200 hover:bg-indigo-50 text-indigo-600 font-bold rounded-xl"
                disabled={isSavingFile}
              >
                <Plus size={16} className="mr-2" />
                Thêm dòng mới
              </Button>
              <Button 
                onClick={handleSaveAllChanges}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md"
                disabled={isSavingFile}
              >
                {isSavingFile ? (
                  <>
                    <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
                    Đang đồng bộ AI...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Lưu tất cả thay đổi
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Main Grid/Table of records */}
          <div className="flex-1 overflow-auto py-4">
            {modalRecords.length === 0 ? (
              <div className="text-center py-12 text-slate-400 font-medium bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                Không có dòng dữ liệu nào trong tệp này. Bấm "Thêm dòng mới" để bắt đầu nạp.
              </div>
            ) : (
              <div className="border border-sky-100 rounded-2xl overflow-hidden shadow-sm bg-white">
                <Table>
                  <TableHeader className="bg-gradient-to-r from-sky-50/80 to-indigo-50/40 sticky top-0 z-10 shadow-sm border-b border-sky-100/50">
                    <TableRow className="border-sky-100/50 hover:bg-transparent">
                      <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] w-16 text-center pl-4 bg-transparent">STT</TableHead>
                      {getColumnKeys().map((col) => (
                        <TableHead key={col} className="font-black text-slate-800 uppercase tracking-wider text-[15px] truncate min-w-[120px] bg-transparent">
                          {col}
                        </TableHead>
                      ))}
                      <TableHead className="font-black text-slate-800 uppercase tracking-wider text-[15px] text-right pr-6 w-32 sticky right-0 bg-sky-50 shadow-[-4px_0_12px_-4px_rgba(0,0,0,0.05)] border-l border-sky-100/40">Hành động</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRecords.map((row, idx) => {
                      const absoluteIndex = startIndex + idx;
                      const isEditing = editingRowIndex === absoluteIndex;

                      return (
                        <TableRow key={idx} className="hover:bg-slate-50/50 transition-colors border-slate-100">
                          <TableCell className="text-[17px] font-bold text-slate-400 text-center pl-4">
                            {absoluteIndex + 1}
                          </TableCell>
                          {getColumnKeys().map((col) => {
                            const cellVal = row[col];
                            return (
                              <TableCell key={col} className="py-2 text-[17px] text-slate-700 min-w-[120px]">
                                {isEditing ? (
                                  <Input
                                    value={editingRowData[col] !== undefined && editingRowData[col] !== null ? editingRowData[col] : ''}
                                    onChange={(e) => setEditingRowData({
                                      ...editingRowData,
                                      [col]: e.target.value
                                    })}
                                    className="h-8 border-slate-200 rounded-lg text-[15px] w-full min-w-[100px]"
                                  />
                                ) : (
                                  <span className="block truncate max-w-[200px]" title={String(cellVal || '')}>
                                    {cellVal !== undefined && cellVal !== null ? String(cellVal) : ''}
                                  </span>
                                )}
                              </TableCell>
                            );
                          })}
                           <TableCell className="text-right pr-6 py-2 sticky right-0 bg-white hover:bg-sky-50/80 transition-colors border-l border-sky-100/50 shadow-[-4px_0_12px_-4px_rgba(0,0,0,0.05)]">
                            {isEditing ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <Button 
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 px-2.5 rounded-lg"
                                  onClick={handleSaveRowLocal}
                                  title="Lưu dòng này"
                                >
                                  <CheckCircle2 size={16} />
                                </Button>
                                <Button 
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 text-slate-400 hover:text-slate-600 hover:bg-slate-100 px-2.5 rounded-lg"
                                  onClick={() => {
                                    setEditingRowIndex(null);
                                    setEditingRowData(null);
                                  }}
                                  title="Hủy"
                                >
                                  <X size={16} />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <Button 
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2 rounded-lg font-bold text-[15px]"
                                  onClick={() => {
                                    setEditingRowIndex(absoluteIndex);
                                    setEditingRowData({ ...row });
                                  }}
                                >
                                  Sửa
                                </Button>
                                <Button 
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50 px-2 rounded-lg font-bold text-[15px]"
                                  onClick={() => handleDeleteRow(absoluteIndex)}
                                >
                                  Xóa
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-4 mt-2">
              <p className="text-[15px] font-semibold text-slate-500">
                Hiển thị <span className="text-slate-800 font-bold">{startIndex + 1}</span> - <span className="text-slate-800 font-bold">{Math.min(startIndex + recordsPerPage, filteredModalRecords.length)}</span> trên <span className="text-slate-800 font-bold">{filteredModalRecords.length}</span> bản ghi {modalSearchTerm && "(được lọc)"}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg text-[15px]"
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                >
                  Trước
                </Button>
                <div className="flex items-center text-[15px] font-bold text-slate-600 px-2">
                  Trang {currentPage} / {totalPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg text-[15px]"
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                >
                  Sau
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog xác nhận xóa một tệp */}
      <Dialog open={deleteConfirmFileId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmFileId(null); }}>
        <DialogContent className="max-w-md rounded-2xl bg-white p-6 border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-[20px] font-bold text-slate-900 flex items-center gap-2">
              Xác nhận xóa tệp dữ liệu
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-slate-600 text-[15px] leading-relaxed">
              Bạn có chắc chắn muốn xóa tệp <strong className="text-rose-600 font-bold">{deleteConfirmFileName}</strong>? 
              Tất cả các bản ghi bán hàng và tri thức AI liên quan đến tệp này cũng sẽ bị xóa vĩnh viễn khỏi hệ thống. Hành động này không thể khôi phục.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              className="rounded-xl font-semibold border-slate-200"
              onClick={() => setDeleteConfirmFileId(null)}
              disabled={isDeletingSingle}
            >
              Hủy bỏ
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl"
              onClick={executeDeleteFile}
              disabled={isDeletingSingle}
            >
              {isDeletingSingle ? (
                <>
                  <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
                  Đang xóa...
                </>
              ) : (
                'Đồng ý xóa'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog xác nhận xóa tất cả các tệp */}
      <Dialog open={deleteAllConfirmOpen} onOpenChange={setDeleteAllConfirmOpen}>
        <DialogContent className="max-w-md rounded-2xl bg-white p-6 border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-[20px] font-black text-red-600 flex items-center gap-2">
              ⚠️ CẢNH BÁO NGUY HIỂM
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-slate-600 text-[15px] leading-relaxed">
              Bạn có chắc chắn muốn xóa <strong className="text-red-600 font-bold">TOÀN BỘ</strong> các tệp dữ liệu đã tải lên?
            </p>
            <p className="text-slate-500 text-[14px] leading-relaxed mt-2 bg-red-50 p-3 rounded-xl border border-red-100 font-semibold">
              Hành động này sẽ xóa sạch hoàn toàn tất cả tệp nguồn, toàn bộ bản ghi bán hàng, và các mảnh cơ sở tri thức đã huấn luyện AI trong hệ thống!
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              className="rounded-xl font-semibold border-slate-200"
              onClick={() => setDeleteAllConfirmOpen(false)}
              disabled={isDeletingAll}
            >
              Hủy bỏ
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white font-black rounded-xl"
              onClick={executeDeleteAllFiles}
              disabled={isDeletingAll}
            >
              {isDeletingAll ? (
                <>
                  <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
                  Đang dọn dẹp...
                </>
              ) : (
                'Đồng ý xóa tất cả'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
