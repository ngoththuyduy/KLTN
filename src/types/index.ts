export type UserRole = 'SALES_ADMIN' | 'SALES_MANAGER' | 'SYSTEM_ADMIN';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: any;
}

export interface SalesFile {
  id: string;
  fileName: string;
  uploadDate: any;
  uploadedBy: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'ERROR';
  recordCount: number;
  metadata: string;
  embeddingStatus: 'NONE' | 'PROCESSING' | 'READY' | 'FAILED' | 'OPTIMIZING';
  records?: any[];
  sampleRows?: any[];
}

export interface SalesRecord {
  id: string;
  fileId: string;
  date: string;
  product: string;
  category: string;
  quantity: number;
  price: number;
  revenue: number;
  region: string;
  customer: string;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  lastUpdated: any;
  sourceFiles: string[]; // fileIds
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: any;
  chartData?: any;
  usedCitations?: string[];
}

export interface Report {
  id: string;
  title: string;
  content: string;
  generatedBy: string;
  createdAt: any;
  fileType: 'PDF' | 'EXCEL';
  reportType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
}

export interface SystemConfig {
  geminiApiKey?: string;
  modelName: string;
  systemPrompt: string;
  schedulerTime: string;
}
