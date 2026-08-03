import { authenticatedFetch } from '@/lib/api';

export async function getEmbedding(text: string): Promise<number[]> {
  const sanitizedText = (text && text.trim()) ? text.trim() : "Dữ liệu trống";
  const result = await getEmbeddings([sanitizedText]);
  if (!result[0]) {
    throw new Error('Embedding response did not include a vector.');
  }
  return result[0];
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts || texts.length === 0) return [];
  
  const sanitizedTexts = texts.map(t => (t && t.trim()) ? t.trim() : "Dữ liệu trống");
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await authenticatedFetch("/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: sanitizedTexts }),
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (!response.ok) {
      throw new Error("Failed to fetch embeddings from AI Server");
    }
    
    const data = await response.json();
    return data.embeddings || [];
  } catch (err) {
    clearTimeout(id);
    console.warn("Embedding fetch timed out or failed:", err);
    throw err;
  }
}

/**
 * Executes an embedding fetch for a single chunk while exposing RateLimitError (429)
 */
export async function getEmbeddingWithRateLimit(text: string): Promise<number[]> {
  const sanitizedText = (text && text.trim()) ? text.trim() : "Dữ liệu trống";
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await authenticatedFetch("/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [sanitizedText] }),
      signal: controller.signal
    });
    
    clearTimeout(id);
    
    if (response.status === 429) {
      const err = new Error("RateLimitError");
      (err as any).status = 429;
      throw err;
    }
    
    if (!response.ok) {
      throw new Error("Failed to fetch embeddings from AI Server");
    }
    
    const data = await response.json();
    if (!data.embeddings?.[0]) {
      throw new Error('Embedding response did not include a vector.');
    }
    return data.embeddings[0];
  } catch (err: any) {
    clearTimeout(id);
    if (err.message === "RateLimitError" || err.status === 429) {
      throw err;
    }
    console.warn("Embedding fetch timed out or failed in rate limiting endpoint:", err);
    throw err;
  }
}

/**
 * LÀM MỚI: Hàm xử lý gom cụm (Batching) thông minh cho file dữ liệu lớn
 * Giúp vượt qua giới hạn Rate Limit của Google AI Studio một cách tự động.
 */
export async function getEmbeddingsInBatches(
  texts: string[], 
  batchSize: number = 50, 
  onProgress?: (completed: number, total: number) => void
): Promise<number[][]> {
  if (!texts || texts.length === 0) return [];
  
  const allEmbeddings: number[][] = [];
  const total = texts.length;
  
  // Hàm phụ trợ tạo độ trễ (Sleep)
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  for (let i = 0; i < total; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const sanitizedBatch = batch.map(t => (t && t.trim()) ? t.trim() : "Dữ liệu trống");
    
    let retryCount = 0;
    const maxRetries = 5;
    let success = false;

    while (!success && retryCount < maxRetries) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 20000); // 20 giây timeout cho mảng lớn

      try {
        const response = await authenticatedFetch("/api/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: sanitizedBatch }),
          signal: controller.signal
        });

        clearTimeout(id);

        if (response.status === 429) {
          retryCount++;
          const waitTime = retryCount * 5000; // Tự động tăng thời gian chờ: 5s, 10s, 15s...
          console.warn(`⚠️ Đang dính Rate Limit (429). Thử lại lần ${retryCount}/${maxRetries} sau ${waitTime/1000} giây...`);
          await sleep(waitTime);
          continue;
        }

        if (!response.ok) {
          throw new Error("Failed to fetch embeddings from AI Server");
        }

        const data = await response.json();
        if (data.embeddings && data.embeddings.length > 0) {
          allEmbeddings.push(...data.embeddings);
          success = true;
        } else {
          throw new Error("Empty embeddings returned");
        }

      } catch (err) {
        clearTimeout(id);
        retryCount++;
        console.warn(`❌ Lỗi kết nối ở cụm dòng ${i}. Đang thử lại...`, err);
        await sleep(3000);
      }
    }

    // If a batch still fails after all retries, stop ingestion instead of storing fake vectors.
    if (!success) {
      throw new Error(`Could not generate embeddings for batch ${i}-${i + batch.length}`);
    }

    // Thông báo tiến độ ra giao diện/log nếu có
    if (onProgress) {
      onProgress(Math.min(i + batch.length, total), total);
    }

    // Nghỉ 2 giây giữa mỗi cụm để bảo vệ băng thông
    await sleep(2000);
  }

  return allEmbeddings;
}
