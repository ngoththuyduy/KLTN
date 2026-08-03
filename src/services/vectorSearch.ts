import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { cosineSimilarity } from '@/utils/cosineSimilarity';
import { KnowledgeChunk } from '@/types/embedding';

// In-memory cache for knowledge chunks per fileId
const chunksMemoryCache = new Map<string, KnowledgeChunk[]>();

export async function searchChunks(
  queryVector: number[],
  topK = 5,
  sourceFiles?: string[]
): Promise<{ chunk: KnowledgeChunk; score: number }[]> {
  if (!queryVector || queryVector.length === 0) {
    return [];
  }
  try {
    const chunksCollection = collection(db, 'knowledge_chunks');
    const allChunks: KnowledgeChunk[] = [];
    
    // Check if sourceFiles are specified
    if (sourceFiles && sourceFiles.length > 0) {
      const filesToFetch: string[] = [];
      for (const fId of sourceFiles) {
        if (chunksMemoryCache.has(fId)) {
          allChunks.push(...chunksMemoryCache.get(fId)!);
        } else {
          filesToFetch.push(fId);
        }
      }

      if (filesToFetch.length > 0) {
        const maxBatchSize = 10;
        for (let i = 0; i < filesToFetch.length; i += maxBatchSize) {
          const batch = filesToFetch.slice(i, i + maxBatchSize);
          const q = query(chunksCollection, where('sourceFileId', 'in', batch));
          const bSnap = await getDocs(q);
          
          const batchMap = new Map<string, KnowledgeChunk[]>();
          bSnap.docs.forEach(docSnap => {
            const data = docSnap.data();
            const fId = data.sourceFileId || 'default';
            const chunk: KnowledgeChunk = {
              id: docSnap.id,
              sourceFile: data.sourceFile || 'Unknown File',
              text: data.text || '',
              embedding: data.embedding || [],
              createdAt: data.createdAt
            };
            if (!batchMap.has(fId)) batchMap.set(fId, []);
            batchMap.get(fId)!.push(chunk);
            allChunks.push(chunk);
          });

          // Store fetched chunks in cache
          batchMap.forEach((chunks, fId) => {
            chunksMemoryCache.set(fId, chunks);
          });
        }
      }
    } else {
      // Query all chunks
      const q = query(chunksCollection);
      const snapshot = await getDocs(q);
      snapshot.docs.forEach((docSnap: any) => {
        const data = docSnap.data();
        allChunks.push({
          id: docSnap.id,
          sourceFile: data.sourceFile || 'Unknown File',
          text: data.text || '',
          embedding: data.embedding || [],
          createdAt: data.createdAt
        });
      });
    }
    
    const results: { chunk: KnowledgeChunk; score: number }[] = [];
    
    allChunks.forEach(chunk => {
      if (chunk.embedding && chunk.embedding.length > 0) {
        const score = cosineSimilarity(queryVector, chunk.embedding);
        results.push({ chunk, score });
      }
    });
    
    // Sort similarity descending
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, topK);
  } catch (error) {
    console.warn("Vector Search Error:", error);
    return [];
  }
}
